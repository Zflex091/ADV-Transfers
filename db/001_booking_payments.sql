-- Apply once to the application's first-party PostgreSQL database before
-- enabling checkout. The application only accesses this table server-side.
CREATE TABLE IF NOT EXISTS adv_booking_orders (
    id uuid PRIMARY KEY,
    booking_code text NOT NULL UNIQUE,
    client_request_id uuid NOT NULL UNIQUE,
    request_hash char(64) NOT NULL,
    status_token_hash char(64) NOT NULL,
    booking_snapshot jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
    payment_method text NOT NULL
        CHECK (payment_method IN ('online-full', 'pay-in-vehicle')),
    currency text NOT NULL DEFAULT 'eur'
        CHECK (currency = 'eur'),
    total_cents integer NOT NULL CHECK (total_cents > 0),
    due_now_cents integer NOT NULL CHECK (due_now_cents > 0),
    balance_cents integer NOT NULL CHECK (balance_cents >= 0),
    paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0),
    stripe_session_id text UNIQUE,
    stripe_session_url text,
    stripe_payment_intent_id text UNIQUE,
    checkout_claimed_at timestamptz,
    paid_at timestamptz,
    confirmation_email_sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT adv_order_amounts_check
        CHECK (total_cents = due_now_cents + balance_cents),
    CONSTRAINT adv_order_paid_check
        CHECK (
            (status = 'paid' AND paid_cents = due_now_cents)
            OR (status <> 'paid' AND paid_cents = 0)
        )
);

CREATE INDEX IF NOT EXISTS adv_booking_orders_created_at_idx
    ON adv_booking_orders (created_at DESC);
