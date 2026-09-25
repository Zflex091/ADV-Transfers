-- Apply after 001_booking_payments.sql to the same first-party PostgreSQL database.
-- A single row per order makes duplicate Stripe webhook deliveries harmless.
CREATE TABLE IF NOT EXISTS adv_booking_email_outbox (
    order_id uuid PRIMARY KEY REFERENCES adv_booking_orders(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'sending', 'sent')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    lease_expires_at timestamptz,
    last_error_code text,
    provider_message_id text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT adv_email_sent_has_timestamp
        CHECK (state <> 'sent' OR sent_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS adv_booking_email_outbox_pending_idx
    ON adv_booking_email_outbox (next_attempt_at, created_at)
    WHERE state <> 'sent';

CREATE INDEX IF NOT EXISTS adv_booking_orders_email_recovery_idx
    ON adv_booking_orders (created_at)
    WHERE status = 'paid' AND confirmation_email_sent_at IS NULL;
