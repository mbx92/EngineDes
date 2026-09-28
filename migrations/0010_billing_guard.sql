-- [MBX-8][CASH-001][BILL-001..003][PAY-001..003][NFR-SEC-002] Tenant-isolated billing and money flow.
--> statement-breakpoint
ALTER TABLE cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON cash_accounts TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE financial_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON financial_documents TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE financial_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_document_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON financial_document_events TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON payments TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON payment_allocations TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON cash_accounts, financial_documents, payments TO enginedes_app;
GRANT SELECT, INSERT ON financial_document_events, payment_allocations TO enginedes_app;
--> statement-breakpoint
-- [PAY-003][AUDIT-001] Status trail and allocation history are append-only.
CREATE FUNCTION billing_prevent_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Billing history records are immutable';
END $$;
CREATE TRIGGER financial_document_event_immutable BEFORE UPDATE OR DELETE ON financial_document_events FOR EACH ROW EXECUTE FUNCTION billing_prevent_change();
CREATE TRIGGER payment_allocation_immutable BEFORE UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION billing_prevent_change();
--> statement-breakpoint
-- [PAY-001][PAY-002] Enforce available/outstanding and settle the document in the same statement,
-- so a direct insert cannot oversell a balance even if a caller skips Core services.
CREATE FUNCTION payment_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pay record; doc record;
BEGIN
  SELECT amount, allocated, status INTO pay FROM payments
    WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id FOR UPDATE;
  IF pay IS NULL THEN RAISE EXCEPTION 'Payment unavailable'; END IF;
  IF pay.status <> 'posted' THEN RAISE EXCEPTION 'Payment is not posted'; END IF;
  IF pay.amount - pay.allocated < NEW.amount THEN RAISE EXCEPTION 'Allocation exceeds payment available amount'; END IF;
  SELECT amount, outstanding, status INTO doc FROM financial_documents
    WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id FOR UPDATE;
  IF doc IS NULL THEN RAISE EXCEPTION 'Document unavailable'; END IF;
  IF doc.status <> 'open' THEN RAISE EXCEPTION 'Document is not open'; END IF;
  IF doc.outstanding < NEW.amount THEN RAISE EXCEPTION 'Allocation exceeds document outstanding'; END IF;
  UPDATE payments SET allocated = allocated + NEW.amount
    WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
  -- Only this allocation path may move an outstanding balance.
  PERFORM set_config('app.billing_allocation', 'on', true);
  UPDATE financial_documents SET outstanding = outstanding - NEW.amount,
    status = CASE WHEN outstanding - NEW.amount = 0 THEN 'paid' ELSE 'open' END
    WHERE tenant_id = NEW.tenant_id AND id = NEW.document_id;
  PERFORM set_config('app.billing_allocation', '', true);
  RETURN NEW;
END $$;
CREATE TRIGGER payment_allocation_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION payment_allocation_guard();
--> statement-breakpoint
-- [BILL-001][PAY-003] A document cannot be rewritten, and an outstanding balance cannot be
-- reduced by direct SQL: it only moves through payment allocation.
CREATE FUNCTION financial_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id <> NEW.tenant_id OR NEW.amount <> OLD.amount OR NEW.type <> OLD.type
    OR NEW.number <> OLD.number OR NEW.book_date <> OLD.book_date OR NEW.due_date <> OLD.due_date THEN
    RAISE EXCEPTION 'Document financial facts are immutable';
  END IF;
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'Voided document is immutable'; END IF;
  IF NEW.outstanding <> OLD.outstanding AND coalesce(current_setting('app.billing_allocation', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Outstanding changes only through payment allocation';
  END IF;
  IF NEW.outstanding > OLD.outstanding THEN RAISE EXCEPTION 'Outstanding cannot increase'; END IF;
  IF NEW.status = 'void' AND OLD.status <> 'void' THEN
    IF NEW.voided_by IS NULL THEN RAISE EXCEPTION 'Void requires an actor'; END IF;
    IF EXISTS (SELECT 1 FROM payment_allocations a WHERE a.tenant_id = NEW.tenant_id AND a.document_id = NEW.id) THEN
      RAISE EXCEPTION 'Void is not permitted once allocations exist';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER financial_document_guard BEFORE UPDATE ON financial_documents FOR EACH ROW EXECUTE FUNCTION financial_document_guard();
--> statement-breakpoint
CREATE FUNCTION payment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id <> NEW.tenant_id OR NEW.amount <> OLD.amount OR NEW.direction <> OLD.direction
    OR NEW.number <> OLD.number OR NEW.party_id <> OLD.party_id OR NEW.cash_account_id <> OLD.cash_account_id
    OR NEW.book_date <> OLD.book_date THEN
    RAISE EXCEPTION 'Posted payment facts are immutable';
  END IF;
  IF NEW.allocated < OLD.allocated THEN RAISE EXCEPTION 'Payment allocated amount cannot decrease'; END IF;
  IF OLD.status = 'void' THEN RAISE EXCEPTION 'Voided payment is immutable'; END IF;
  IF NEW.status = 'void' AND OLD.status <> 'void' AND OLD.allocated > 0 THEN
    RAISE EXCEPTION 'Void is not permitted once the payment is allocated';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_guard BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payment_guard();
