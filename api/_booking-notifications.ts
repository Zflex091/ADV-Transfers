import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { Pool } from "pg";

import { renderOwnerBookingEmail } from "./_booking-email.js";
import { getOrderById, type OrderRecord } from "./_orders.js";

export type EmailDeliveryResult =
  | "sent"
  | "already-sent"
  | "busy"
  | "failed"
  | "not-eligible";

type ClaimRow = { order_id: string; attempts: number; lease_token: string };
type OutboxStateRow = { state: "pending" | "sending" | "sent" };
type PendingRow = { order_id: string };

let pool: Pool | null = null;

function database(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL nesukonfigūruotas.");
  }
  if (!pool) pool = new Pool({ connectionString, max: 2 });
  return pool;
}

function smtpSettings() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || user;
  const to = process.env.BOOKING_OWNER_EMAIL?.trim();
  const port = Number(process.env.SMTP_PORT?.trim() || "587");

  if (
    !host || !user || !pass || !from || !to ||
    !Number.isInteger(port) || port < 1 || port > 65535 ||
    /[\r\n]/.test(from) ||
    !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(to)
  ) {
    throw new Error("smtp-config-missing");
  }
  return { host, port, secure: port === 465, auth: { user, pass }, from, to };
}

function retryMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.min(6, Math.max(0, attempts - 1)));
}

/**
 * Persist the notification before attempting SMTP. Only a database-confirmed
 * paid order can enter the queue; repeated webhook deliveries reuse its row.
 */
export async function queueOwnerBookingEmail(orderId: string): Promise<boolean> {
  const order = await getOrderById(orderId);
  if (!order || order.status !== "paid") return false;
  await database().query(
    `INSERT INTO adv_booking_email_outbox (order_id)
     SELECT id FROM adv_booking_orders
     WHERE id = $1 AND status = 'paid'
     ON CONFLICT (order_id) DO NOTHING`,
    [orderId],
  );
  return true;
}

async function claimEmail(orderId: string): Promise<ClaimRow | null> {
  const leaseToken = randomUUID();
  const claimed = await database().query<ClaimRow>(
    `UPDATE adv_booking_email_outbox
     SET state = 'sending', attempts = attempts + 1,
         lease_token = $2, lease_expires_at = NOW() + INTERVAL '2 minutes',
         updated_at = NOW()
     WHERE order_id = $1 AND next_attempt_at <= NOW()
       AND (
         state = 'pending'
         OR (state = 'sending' AND lease_expires_at < NOW())
       )
       AND EXISTS (
         SELECT 1 FROM adv_booking_orders
         WHERE id = $1 AND status = 'paid'
       )
     RETURNING order_id, attempts, lease_token`,
    [orderId, leaseToken],
  );
  return claimed.rows[0] ?? null;
}

async function recordFailure(
  claim: ClaimRow,
  code: "smtp-config-missing" | "smtp-unavailable" | "render-failed",
): Promise<void> {
  await database().query(
    `UPDATE adv_booking_email_outbox
     SET state = 'pending', lease_token = NULL, lease_expires_at = NULL,
         next_attempt_at = NOW() + ($3::integer * INTERVAL '1 minute'),
         last_error_code = $4, updated_at = NOW()
     WHERE order_id = $1 AND state = 'sending' AND lease_token = $2`,
    [claim.order_id, claim.lease_token, retryMinutes(claim.attempts), code],
  );
}

async function recordSent(claim: ClaimRow, messageId: string | null): Promise<void> {
  const saved = await database().query<{ id: string }>(
    `WITH delivered AS (
       UPDATE adv_booking_email_outbox
       SET state = 'sent', sent_at = NOW(),
           provider_message_id = $3, lease_token = NULL,
           lease_expires_at = NULL, last_error_code = NULL, updated_at = NOW()
       WHERE order_id = $1 AND state = 'sending' AND lease_token = $2
       RETURNING order_id, sent_at
     )
     UPDATE adv_booking_orders AS booking
     SET confirmation_email_sent_at = delivered.sent_at, updated_at = NOW()
     FROM delivered WHERE booking.id = delivered.order_id
     RETURNING booking.id`,
    [claim.order_id, claim.lease_token, messageId],
  );
  if (saved.rowCount !== 1) {
    // SMTP accepted the message, but the database did not acknowledge it.
    // Surface this for operational review instead of claiming a successful send.
    throw new Error("booking-email-sent-state-not-saved");
  }
}

async function deliver(order: OrderRecord): Promise<{ messageId: string | null }> {
  const settings = smtpSettings();
  const email = renderOwnerBookingEmail(order);
  const transporter = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: settings.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  const sent = await transporter.sendMail({
    from: settings.from,
    to: settings.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  });
  const expectedRecipient = settings.to.toLowerCase();
  const accepted = Array.isArray(sent.accepted) && sent.accepted.some((recipient) => {
    return recipient.toLowerCase() === expectedRecipient;
  });
  if (!accepted) throw new Error("smtp-recipient-not-accepted");
  return {
    messageId:
      typeof sent.messageId === "string" && sent.messageId.length <= 255
        ? sent.messageId
        : null,
  };
}

/**
 * Duplicate webhook deliveries and concurrent retry workers cannot claim the
 * same row at once. SMTP failures remain queued with bounded backoff.
 */
export async function sendOwnerBookingEmail(
  orderId: string,
): Promise<EmailDeliveryResult> {
  if (!(await queueOwnerBookingEmail(orderId))) return "not-eligible";
  const claim = await claimEmail(orderId);
  if (!claim) {
    const current = await database().query<OutboxStateRow>(
      "SELECT state FROM adv_booking_email_outbox WHERE order_id = $1",
      [orderId],
    );
    return current.rows[0]?.state === "sent" ? "already-sent" : "busy";
  }

  const order = await getOrderById(orderId);
  if (!order || order.status !== "paid") {
    await recordFailure(claim, "render-failed");
    return "not-eligible";
  }

  let messageId: string | null;
  try {
    ({ messageId } = await deliver(order));
  } catch (error) {
    const code =
      error instanceof Error && error.message === "smtp-config-missing"
        ? "smtp-config-missing"
        : "smtp-unavailable";
    await recordFailure(claim, code);
    return "failed";
  }

  await recordSent(claim, messageId);
  return "sent";
}

/** Reconcile paid orders whose initial webhook was interrupted, then retry. */
export async function processPendingBookingEmails(
  requestedLimit = 2,
): Promise<{ sent: number; failed: number; skipped: number }> {
  const limit = Math.min(3, Math.max(1, Math.trunc(requestedLimit) || 2));
  await database().query(
    `INSERT INTO adv_booking_email_outbox (order_id)
     SELECT booking.id FROM adv_booking_orders AS booking
     WHERE booking.status = 'paid' AND booking.confirmation_email_sent_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM adv_booking_email_outbox AS queued
         WHERE queued.order_id = booking.id
       )
     ORDER BY booking.created_at
     LIMIT $1
     ON CONFLICT (order_id) DO NOTHING`,
    [limit],
  );
  const pending = await database().query<PendingRow>(
    `SELECT outbox.order_id
     FROM adv_booking_email_outbox AS outbox
     JOIN adv_booking_orders AS booking ON booking.id = outbox.order_id
     WHERE booking.status = 'paid' AND outbox.next_attempt_at <= NOW()
       AND (
         outbox.state = 'pending'
         OR (outbox.state = 'sending' AND outbox.lease_expires_at < NOW())
       )
     ORDER BY outbox.next_attempt_at, outbox.created_at
     LIMIT $1`,
    [limit],
  );
  const result = { sent: 0, failed: 0, skipped: 0 };
  const outcomes = await Promise.all(pending.rows.map(async (row) => {
    try {
      return await sendOwnerBookingEmail(row.order_id);
    } catch (error) {
      console.error("Užsakymo laiško pakartojimo klaida", row.order_id, error);
      return "failed" as const;
    }
  }));
  for (const outcome of outcomes) {
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "failed") result.failed += 1;
    else result.skipped += 1;
  }
  return result;
}
