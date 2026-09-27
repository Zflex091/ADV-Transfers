-- Run once in the same PostgreSQL / Neon database used by ADV Transfers.
-- Pay-in-vehicle bookings no longer require a Stripe advance, so due_now_cents
-- must be allowed to be 0. Existing online Stripe bookings are unchanged.

ALTER TABLE adv_booking_orders
  DROP CONSTRAINT IF EXISTS adv_booking_orders_due_now_cents_check;

ALTER TABLE adv_booking_orders
  ADD CONSTRAINT adv_booking_orders_due_now_cents_check
  CHECK (due_now_cents >= 0);
