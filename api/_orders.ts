import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";

import {
  calculatePaymentPlan,
  type PaymentPlan,
  type ReservationDraft,
} from "../src/domain/booking.ts";

export type OrderStatus = "pending" | "paid" | "failed" | "cancelled";

export type OrderRecord = Readonly<{
  id: string;
  bookingCode: string;
  status: OrderStatus;
  paymentMethod: PaymentPlan["method"];
  totalCents: number;
  dueNowCents: number;
  balanceCents: number;
  paidCents: number;
  currency: "eur";
  stripeSessionId: string | null;
  stripeSessionUrl: string | null;
  stripePaymentIntentId: string | null;
  bookingSnapshot: ReservationDraft;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  confirmationEmailSentAt: string | null;
}>;

export type CreateOrderInput = Readonly<{
  clientRequestId: string;
  requestHash: string;
  draft: ReservationDraft;
  paymentPlan: PaymentPlan;
}>;

export class OrderConflictError extends Error {
  constructor() {
    super("Šis mokėjimo bandymas jau panaudotas kitam užsakymui.");
    this.name = "OrderConflictError";
  }
}

export class OrderStoreConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderStoreConfigurationError";
  }
}

type OrderRow = {
  id: string;
  booking_code: string;
  status: OrderStatus;
  payment_method: PaymentPlan["method"];
  total_cents: number;
  due_now_cents: number;
  balance_cents: number;
  paid_cents: number;
  currency: "eur";
  stripe_session_id: string | null;
  stripe_session_url: string | null;
  stripe_payment_intent_id: string | null;
  booking_snapshot: ReservationDraft;
  created_at: Date;
  updated_at: Date;
  paid_at: Date | null;
  confirmation_email_sent_at: Date | null;
  request_hash: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_HASH_PATTERN = /^[0-9a-f]{64}$/i;
let pool: Pool | null = null;

function database(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new OrderStoreConfigurationError("DATABASE_URL nesukonfigūruotas.");
  }
  if (!pool) {
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

function tokenSecret(): string {
  const secret = process.env.ORDER_STATUS_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new OrderStoreConfigurationError(
      "ORDER_STATUS_SECRET turi būti bent 32 simbolių.",
    );
  }
  return secret;
}

function statusTokenForId(orderId: string): string {
  return createHmac("sha256", tokenSecret())
    .update("adv-order-status:v1:" + orderId)
    .digest("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mapOrder(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    bookingCode: row.booking_code,
    status: row.status,
    paymentMethod: row.payment_method,
    totalCents: row.total_cents,
    dueNowCents: row.due_now_cents,
    balanceCents: row.balance_cents,
    paidCents: row.paid_cents,
    currency: row.currency,
    stripeSessionId: row.stripe_session_id,
    stripeSessionUrl: row.stripe_session_url,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    bookingSnapshot: row.booking_snapshot,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    paidAt: row.paid_at?.toISOString() ?? null,
    confirmationEmailSentAt:
      row.confirmation_email_sent_at?.toISOString() ?? null,
  };
}

function validateCreateInput(input: CreateOrderInput): void {
  if (!UUID_PATTERN.test(input.clientRequestId)) {
    throw new TypeError("Neteisingas mokėjimo bandymo identifikatorius.");
  }
  if (!REQUEST_HASH_PATTERN.test(input.requestHash)) {
    throw new TypeError("Neteisinga užsakymo kontrolinė suma.");
  }
  const expected = calculatePaymentPlan(
    input.paymentPlan.method,
    input.draft.pricing.totalCents,
  );
  if (
    input.paymentPlan.currency !== expected.currency ||
    input.paymentPlan.totalCents !== expected.totalCents ||
    input.paymentPlan.amountDueNowCents !== expected.amountDueNowCents ||
    input.paymentPlan.remainingAfterSuccessfulPaymentCents !==
      expected.remainingAfterSuccessfulPaymentCents ||
    input.draft.paymentMethod !== expected.method
  ) {
    throw new TypeError("Užsakymo ir mokėjimo sumos nesutampa.");
  }
}

export async function createOrGetPendingOrder(
  input: CreateOrderInput,
): Promise<{ order: OrderRecord; statusToken: string; created: boolean }> {
  validateCreateInput(input);
  const id = randomUUID();
  const statusToken = statusTokenForId(id);
  const result = await database().query<OrderRow>(
    `INSERT INTO adv_booking_orders (
      id, booking_code, client_request_id, request_hash,
      status_token_hash, booking_snapshot, payment_method,
      total_cents, due_now_cents, balance_cents
    ) VALUES (
      $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10
    )
    ON CONFLICT (client_request_id) DO NOTHING
    RETURNING *`,
    [
      id,
      "ADV-" + randomBytes(6).toString("hex").toUpperCase(),
      input.clientRequestId,
      input.requestHash.toLowerCase(),
      tokenHash(statusToken),
      JSON.stringify(input.draft),
      input.paymentPlan.method,
      input.paymentPlan.totalCents,
      input.paymentPlan.amountDueNowCents,
      input.paymentPlan.remainingAfterSuccessfulPaymentCents,
    ],
  );
  if (result.rows[0]) {
    return { order: mapOrder(result.rows[0]), statusToken, created: true };
  }

  const existing = await database().query<OrderRow>(
    "SELECT * FROM adv_booking_orders WHERE client_request_id = $1",
    [input.clientRequestId],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new Error("Užsakymo pakartotinai rasti nepavyko.");
  }
  if (row.request_hash !== input.requestHash.toLowerCase()) {
    throw new OrderConflictError();
  }
  return {
    order: mapOrder(row),
    statusToken: statusTokenForId(row.id),
    created: false,
  };
}

export async function getOrderById(id: string): Promise<OrderRecord | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const result = await database().query<OrderRow>(
    "SELECT * FROM adv_booking_orders WHERE id = $1",
    [id],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function findOrderBySessionId(
  sessionId: string,
): Promise<OrderRecord | null> {
  if (!sessionId || sessionId.length > 255) return null;
  const result = await database().query<OrderRow>(
    "SELECT * FROM adv_booking_orders WHERE stripe_session_id = $1",
    [sessionId],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function getOrderForStatus(
  id: string,
  statusToken: string,
): Promise<OrderRecord | null> {
  if (!UUID_PATTERN.test(id) || !TOKEN_PATTERN.test(statusToken)) return null;
  const result = await database().query<OrderRow>(
    "SELECT * FROM adv_booking_orders WHERE id = $1 AND status_token_hash = $2",
    [id, tokenHash(statusToken)],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

/**
 * A short database lease prevents simultaneous requests for the same order
 * from creating two Checkout Sessions. Stripe must also receive an idempotency
 * key derived from the order ID so a crashed request can be safely retried.
 */
export async function claimCheckoutCreation(id: string): Promise<boolean> {
  if (!UUID_PATTERN.test(id)) return false;
  const result = await database().query(
    `UPDATE adv_booking_orders
     SET checkout_claimed_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'pending' AND stripe_session_id IS NULL
       AND (
         checkout_claimed_at IS NULL
         OR checkout_claimed_at < NOW() - INTERVAL '90 seconds'
       )
     RETURNING id`,
    [id],
  );
  return result.rowCount === 1;
}

export async function releaseCheckoutCreation(id: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) return;
  await database().query(
    `UPDATE adv_booking_orders
     SET checkout_claimed_at = NULL, updated_at = NOW()
     WHERE id = $1 AND stripe_session_id IS NULL AND status = 'pending'`,
    [id],
  );
}

export async function attachCheckoutSession(
  id: string,
  sessionId: string,
  sessionUrl: string,
): Promise<OrderRecord | null> {
  if (!UUID_PATTERN.test(id) || !sessionId || !sessionUrl) return null;
  const result = await database().query<OrderRow>(
    `UPDATE adv_booking_orders
     SET stripe_session_id = $2, stripe_session_url = $3,
         checkout_claimed_at = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
       AND (stripe_session_id IS NULL OR stripe_session_id = $2)
     RETURNING *`,
    [id, sessionId, sessionUrl],
  );
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}

export async function markPaid(input: {
  orderId: string;
  sessionId: string;
  paymentIntentId: string | null;
  amountCents: number;
  currency: "eur";
}): Promise<OrderRecord | null> {
  if (
    !UUID_PATTERN.test(input.orderId) ||
    !input.sessionId ||
    !Number.isSafeInteger(input.amountCents) ||
    input.currency !== "eur"
  ) return null;
  const result = await database().query<OrderRow>(
    `UPDATE adv_booking_orders
     SET status = 'paid', paid_cents = due_now_cents,
         stripe_payment_intent_id =
           COALESCE(stripe_payment_intent_id, $3),
         paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
     WHERE id = $1 AND stripe_session_id = $2
       AND due_now_cents = $4 AND currency = $5
       AND status <> 'paid'
       AND (
         stripe_payment_intent_id IS NULL
         OR $3::text IS NULL
         OR stripe_payment_intent_id = $3
       )
     RETURNING *`,
    [
      input.orderId,
      input.sessionId,
      input.paymentIntentId,
      input.amountCents,
      input.currency,
    ],
  );
  if (result.rows[0]) return mapOrder(result.rows[0]);
  const existing = await database().query<OrderRow>(
    `SELECT * FROM adv_booking_orders
     WHERE id = $1 AND stripe_session_id = $2
       AND due_now_cents = $3 AND currency = $4 AND status = 'paid'`,
    [input.orderId, input.sessionId, input.amountCents, input.currency],
  );
  return existing.rows[0] ? mapOrder(existing.rows[0]) : null;
}

export async function markFailed(input: {
  orderId: string;
  sessionId: string;
  status: "failed" | "cancelled";
}): Promise<OrderRecord | null> {
  if (!UUID_PATTERN.test(input.orderId) || !input.sessionId) return null;
  const result = await database().query<OrderRow>(
    `UPDATE adv_booking_orders
     SET status = $3, updated_at = NOW()
     WHERE id = $1 AND stripe_session_id = $2 AND status <> 'paid'
     RETURNING *`,
    [input.orderId, input.sessionId, input.status],
  );
  if (result.rows[0]) return mapOrder(result.rows[0]);
  return getOrderById(input.orderId);
}
