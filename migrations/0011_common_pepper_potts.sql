-- [MBX-8][PAY-003] Payment void parity with document void: actor evidence plus a status guard.
ALTER TABLE "payments" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_auth_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payment_void" CHECK (("payments"."status" = 'void') = ("payments"."voided_by" IS NOT NULL));
--> statement-breakpoint
-- Void must name an actor and must never hide an allocated balance. The service refuses both
-- cases, but the guard makes the rule hold even for a caller that skips Core services.
CREATE OR REPLACE FUNCTION payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id <> NEW.tenant_id OR NEW.amount <> OLD.amount OR NEW.direction <> OLD.direction
    OR NEW.number <> OLD.number OR NEW.party_id <> OLD.party_id OR NEW.cash_account_id <> OLD.cash_account_id
    OR NEW.book_date <> OLD.book_date THEN
    RAISE EXCEPTION 'Posted payment facts are immutable';
  END IF;
  IF NEW.allocated < OLD.allocated THEN RAISE EXCEPTION 'Payment allocated amount cannot decrease'; END IF;
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'Voided payment is immutable'; END IF;
  IF NEW.status = 'void' AND OLD.status <> 'void' THEN
    IF NEW.voided_by IS NULL THEN RAISE EXCEPTION 'Void requires an actor'; END IF;
    IF EXISTS (SELECT 1 FROM payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.payment_id = NEW.id) THEN
      RAISE EXCEPTION 'Void is not permitted once the payment is allocated';
    END IF;
  END IF;
  RETURN NEW;
END $$;
