-- [MBX-6][MBX-7][NFR-SEC-002] Tenant-isolated append-only financial kernel.
--> statement-breakpoint
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON ledger_accounts TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON accounting_periods TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE journals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON journals TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON journal_lines TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE accounting_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON accounting_mappings TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE accounting_mapping_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_mapping_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON accounting_mapping_revisions TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ledger_accounts, accounting_mappings TO enginedes_app;
GRANT SELECT, INSERT ON accounting_periods, journals, journal_lines, accounting_mapping_revisions TO enginedes_app;
--> statement-breakpoint
CREATE FUNCTION journal_prevent_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted financial records are immutable';
END $$;
CREATE TRIGGER journal_immutable BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION journal_prevent_change();
CREATE TRIGGER journal_line_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION journal_prevent_change();
CREATE TRIGGER period_immutable BEFORE UPDATE OR DELETE ON accounting_periods FOR EACH ROW EXECUTE FUNCTION journal_prevent_change();
CREATE TRIGGER mapping_revision_immutable BEFORE UPDATE OR DELETE ON accounting_mapping_revisions FOR EACH ROW EXECUTE FUNCTION journal_prevent_change();
--> statement-breakpoint
CREATE FUNCTION journal_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_xmin text;
BEGIN
  SELECT xmin::text INTO parent_xmin FROM journals WHERE tenant_id = NEW.tenant_id AND id = NEW.journal_id;
  IF parent_xmin IS NULL OR parent_xmin <> txid_current()::text THEN
    RAISE EXCEPTION 'Journal lines must be inserted with their new journal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_line_same_transaction BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION journal_line_guard();
--> statement-breakpoint
CREATE FUNCTION journal_check_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE count_lines integer; total_debit numeric; total_credit numeric; target uuid; tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'journals' THEN
    target := NEW.id;
  ELSE
    target := NEW.journal_id;
  END IF;
  tenant := NEW.tenant_id;
  SELECT count(*), coalesce(sum(debit),0), coalesce(sum(credit),0)
    INTO count_lines,total_debit,total_credit FROM journal_lines WHERE tenant_id = tenant AND journal_id = target;
  IF count_lines < 2 OR total_debit <> total_credit THEN
    RAISE EXCEPTION 'Journal is not balanced';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balance_header AFTER INSERT ON journals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_check_balance();
CREATE CONSTRAINT TRIGGER journal_balance_line AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_check_balance();
--> statement-breakpoint
CREATE UNIQUE INDEX journals_one_reversal ON journals (tenant_id, corrects_id) WHERE kind = 'reversal';
