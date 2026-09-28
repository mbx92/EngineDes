CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"command_id" uuid NOT NULL,
	"book_date" date NOT NULL,
	"reason" text NOT NULL,
	"reference" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_tenant_id_command_id_unique" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "payment_refund_amount" CHECK ("payment_refunds"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_payment_id_payments_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_document_id_financial_documents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."financial_documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- [MBX-8][PAY-003][BILL-001][NFR-SEC-002] Tenant-isolated refund history.
ALTER TABLE payment_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON payment_refunds TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
-- A refunded allocation is history: it may only be appended to, never rewritten or removed.
GRANT SELECT, INSERT ON payment_refunds TO enginedes_app;
CREATE TRIGGER payment_refund_immutable BEFORE UPDATE OR DELETE ON payment_refunds FOR EACH ROW EXECUTE FUNCTION billing_prevent_change();
--> statement-breakpoint
-- [MBX-8][PAY-003][BILL-001] A refund is bounded by what was actually collected against the
-- document, and restoring outstanding needs the same private flag the allocation path uses.
-- Reference row locks are ordered payment then document, matching the allocation guard, so a
-- concurrent allocation and refund cannot deadlock or oversell the same balance.
CREATE OR REPLACE FUNCTION payment_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE collected bigint; refunded bigint; doc record; pay_status text;
BEGIN
  SELECT status INTO pay_status FROM payments
    WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id FOR UPDATE;
  IF pay_status IS NULL THEN RAISE EXCEPTION 'Payment unavailable'; END IF;
  IF pay_status <> 'posted' THEN RAISE EXCEPTION 'Payment is not posted'; END IF;
  SELECT amount INTO collected FROM payment_allocations
    WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id AND document_id = NEW.document_id;
  IF collected IS NULL THEN RAISE EXCEPTION 'Refund requires an existing allocation'; END IF;
  IF NEW.amount > collected THEN RAISE EXCEPTION 'Refund exceeds the allocated amount'; END IF;
  SELECT coalesce(sum(amount), 0) INTO refunded FROM payment_refunds
    WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id AND document_id = NEW.document_id;
  IF refunded + NEW.amount > collected THEN RAISE EXCEPTION 'Refund exceeds the allocated amount'; END IF;
  -- Lock the document and keep a refund strictly inside what it collected, so outstanding can
  -- never be pushed above the document amount even across repeated collects and refunds.
  SELECT amount, outstanding, status INTO doc FROM financial_documents
    WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id FOR UPDATE;
  IF doc IS NULL THEN RAISE EXCEPTION 'Document unavailable'; END IF;
  IF doc.status = 'void' THEN RAISE EXCEPTION 'Document is void'; END IF;
  IF doc.outstanding + NEW.amount > doc.amount THEN RAISE EXCEPTION 'Refund exceeds document amount'; END IF;
  -- Only the allocation and refund paths may move an outstanding balance, and each direction has
  -- its own flag: allocation may only decrease it, a refund may only restore it (BILL-001).
  PERFORM set_config('app.billing_refund', 'on', true);
  UPDATE financial_documents SET outstanding = outstanding + NEW.amount,
    status = CASE WHEN outstanding + NEW.amount = 0 THEN 'paid' ELSE 'open' END
    WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id;
  PERFORM set_config('app.billing_refund', '', true);
  RETURN NEW;
END $$;
CREATE TRIGGER payment_refund_guard BEFORE INSERT ON payment_refunds FOR EACH ROW EXECUTE FUNCTION payment_refund_guard();
--> statement-breakpoint
-- [MBX-8][PAY-003][BILL-001] Outstanding may decrease through allocation and increase through a
-- refund; every other path stays rejected. Replaces the Phase 3 guard so the refund flag is the
-- only way to legitimately raise a balance, without widening the allocation path.
CREATE OR REPLACE FUNCTION financial_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id <> NEW.tenant_id OR NEW.amount <> OLD.amount OR NEW.type <> OLD.type
    OR NEW.number <> OLD.number OR NEW.book_date <> OLD.book_date OR NEW.due_date <> OLD.due_date THEN
    RAISE EXCEPTION 'Document financial facts are immutable';
  END IF;
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'Voided document is immutable'; END IF;
  IF NEW.outstanding < OLD.outstanding AND coalesce(current_setting('app.billing_allocation', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Outstanding changes only through payment allocation';
  END IF;
  IF NEW.outstanding > OLD.outstanding AND coalesce(current_setting('app.billing_refund', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Outstanding cannot increase';
  END IF;
  IF NEW.status = 'void' AND OLD.status <> 'void' THEN
    IF NEW.voided_by IS NULL THEN RAISE EXCEPTION 'Void requires an actor'; END IF;
    IF EXISTS (SELECT 1 FROM payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.document_id = NEW.id) THEN
      RAISE EXCEPTION 'Void is not permitted once allocations exist';
    END IF;
  END IF;
  RETURN NEW;
END $$;
