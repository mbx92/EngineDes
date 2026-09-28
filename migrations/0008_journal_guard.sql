-- [MBX-6][ACC-003/005][LOCK-001] Fail closed even for direct journal inserts.
CREATE FUNCTION journal_guard_new() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.kind = 'normal' AND NEW.corrects_id IS NOT NULL)
    OR (NEW.kind IN ('reversal','adjustment') AND NEW.corrects_id IS NULL) THEN
    RAISE EXCEPTION 'Correction reference does not match journal kind';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_periods p
      WHERE p.tenant_id = NEW.tenant_id AND p.month = to_char(NEW.book_date, 'YYYY-MM')) THEN
    RAISE EXCEPTION 'Accounting period is closed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_new_guard BEFORE INSERT ON journals FOR EACH ROW EXECUTE FUNCTION journal_guard_new();
