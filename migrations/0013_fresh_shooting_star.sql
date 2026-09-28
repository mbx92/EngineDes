ALTER TYPE "public"."role_name" ADD VALUE 'procurement' BEFORE 'supervisor';--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"uom" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "items_tenant_id_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "item_kind" CHECK ("items"."kind" IN ('item','service'))
);
--> statement-breakpoint
CREATE TABLE "purchase_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_request_lines_tenant_id_purchase_request_id_line_no_unique" UNIQUE("tenant_id","purchase_request_id","line_no"),
	CONSTRAINT "purchase_request_line_no" CHECK ("purchase_request_lines"."line_no" > 0),
	CONSTRAINT "purchase_request_line_quantity" CHECK ("purchase_request_lines"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"command_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid,
	"requested_by" text NOT NULL,
	"book_date" date NOT NULL,
	"justification" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requests_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "purchase_requests_tenant_id_command_id_unique" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "purchase_requests_tenant_id_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "purchase_request_status" CHECK ("purchase_requests"."status" IN ('draft','submitted')),
	CONSTRAINT "purchase_request_submission" CHECK (("purchase_requests"."status" = 'submitted') = ("purchase_requests"."submitted_by" IS NOT NULL AND "purchase_requests"."submitted_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rfq_vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfq_vendors_tenant_id_rfq_id_party_id_unique" UNIQUE("tenant_id","rfq_id","party_id")
);
--> statement-breakpoint
CREATE TABLE "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"command_id" uuid NOT NULL,
	"purchase_request_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"book_date" date NOT NULL,
	"note" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rfqs_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "rfqs_tenant_id_command_id_unique" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "rfqs_tenant_id_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "vendor_quotation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_quotation_lines_tenant_id_quotation_id_line_no_unique" UNIQUE("tenant_id","quotation_id","line_no"),
	CONSTRAINT "vendor_quotation_line_no" CHECK ("vendor_quotation_lines"."line_no" > 0),
	CONSTRAINT "vendor_quotation_line_quantity" CHECK ("vendor_quotation_lines"."quantity" > 0),
	CONSTRAINT "vendor_quotation_line_price" CHECK ("vendor_quotation_lines"."unit_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "vendor_quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"command_id" uuid NOT NULL,
	"rfq_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"book_date" date NOT NULL,
	"valid_until" date,
	"payment_term" text,
	"delivery_days" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_quotations_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "vendor_quotations_tenant_id_command_id_unique" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "vendor_quotations_tenant_id_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "vendor_quotation_revision" CHECK ("vendor_quotations"."revision" > 0),
	CONSTRAINT "vendor_quotation_delivery" CHECK ("vendor_quotations"."delivery_days" IS NULL OR "vendor_quotations"."delivery_days" > 0),
	CONSTRAINT "vendor_quotation_validity" CHECK ("vendor_quotations"."valid_until" IS NULL OR "vendor_quotations"."valid_until" >= "vendor_quotations"."book_date"),
	CONSTRAINT "vendor_quotation_revision_link" CHECK (("vendor_quotations"."revision" = 1) = ("vendor_quotations"."supersedes_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_tenant_id_purchase_request_id_purchase_requests_tenant_id_id_fk" FOREIGN KEY ("tenant_id","purchase_request_id") REFERENCES "public"."purchase_requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_request_lines" ADD CONSTRAINT "purchase_request_lines_tenant_id_item_id_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_requested_by_auth_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_submitted_by_auth_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requests" ADD CONSTRAINT "purchase_requests_tenant_id_unit_id_location_id_locations_tenant_id_unit_id_id_fk" FOREIGN KEY ("tenant_id","unit_id","location_id") REFERENCES "public"."locations"("tenant_id","unit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_tenant_id_rfq_id_rfqs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rfq_id") REFERENCES "public"."rfqs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_vendors" ADD CONSTRAINT "rfq_vendors_tenant_id_party_id_parties_tenant_id_id_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_tenant_id_purchase_request_id_purchase_requests_tenant_id_id_fk" FOREIGN KEY ("tenant_id","purchase_request_id") REFERENCES "public"."purchase_requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotation_lines" ADD CONSTRAINT "vendor_quotation_lines_tenant_id_quotation_id_vendor_quotations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","quotation_id") REFERENCES "public"."vendor_quotations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotation_lines" ADD CONSTRAINT "vendor_quotation_lines_tenant_id_item_id_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_tenant_id_rfq_id_rfqs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","rfq_id") REFERENCES "public"."rfqs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_tenant_id_party_id_parties_tenant_id_id_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_quotations" ADD CONSTRAINT "vendor_quotations_tenant_id_supersedes_id_vendor_quotations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","supersedes_id") REFERENCES "public"."vendor_quotations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- [MBX-9][PROC-001..003][NFR-SEC-002] Tenant-isolated procurement source documents.
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON items TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON purchase_requests TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE purchase_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_request_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON purchase_request_lines TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfqs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON rfqs TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE rfq_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq_vendors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON rfq_vendors TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE vendor_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_quotations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON vendor_quotations TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE vendor_quotation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_quotation_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON vendor_quotation_lines TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
-- [MBX-9][PROC-001..003] No procurement record is rewritten: a correction is a new quotation
-- revision or a new document. Purchase Request is the single exception, because submitting moves
-- draft -> submitted, and that transition is the only update the guard below permits.
GRANT SELECT, INSERT ON items, purchase_request_lines, rfqs, rfq_vendors, vendor_quotations, vendor_quotation_lines TO enginedes_app;
GRANT SELECT, INSERT, UPDATE ON purchase_requests TO enginedes_app;
--> statement-breakpoint
CREATE FUNCTION procurement_prevent_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Procurement records are immutable';
END $$;
CREATE TRIGGER item_immutable BEFORE UPDATE OR DELETE ON items FOR EACH ROW EXECUTE FUNCTION procurement_prevent_change();
CREATE TRIGGER rfq_immutable BEFORE UPDATE OR DELETE ON rfqs FOR EACH ROW EXECUTE FUNCTION procurement_prevent_change();
CREATE TRIGGER vendor_quotation_immutable BEFORE UPDATE OR DELETE ON vendor_quotations FOR EACH ROW EXECUTE FUNCTION procurement_prevent_change();
CREATE TRIGGER purchase_request_line_immutable BEFORE UPDATE OR DELETE ON purchase_request_lines FOR EACH ROW EXECUTE FUNCTION procurement_prevent_change();
CREATE TRIGGER rfq_vendor_immutable BEFORE UPDATE OR DELETE ON rfq_vendors FOR EACH ROW EXECUTE FUNCTION procurement_prevent_change();
CREATE TRIGGER vendor_quotation_line_immutable BEFORE UPDATE OR DELETE ON vendor_quotation_lines FOR EACH ROW EXECUTE FUNCTION procurement_prevent_change();
--> statement-breakpoint
-- [MBX-9][PROC-001][AUDIT-001] The only permitted write to a submitted workflow document is the
-- draft -> submitted transition. Facts stay immutable and a submitted PR can never move back, so
-- the request is not silently re-opened behind the audit trail.
CREATE FUNCTION purchase_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.tenant_id <> NEW.tenant_id OR NEW.number <> OLD.number OR NEW.command_id <> OLD.command_id
    OR NEW.unit_id <> OLD.unit_id OR NEW.location_id IS DISTINCT FROM OLD.location_id
    OR NEW.requested_by <> OLD.requested_by OR NEW.book_date <> OLD.book_date
    OR NEW.justification <> OLD.justification THEN
    RAISE EXCEPTION 'Purchase Request facts are immutable';
  END IF;
  IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'Submitted Purchase Request is immutable'; END IF;
  IF NEW.status <> 'submitted' THEN RAISE EXCEPTION 'Purchase Request may only advance to submitted'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_request_guard BEFORE UPDATE ON purchase_requests FOR EACH ROW EXECUTE FUNCTION purchase_request_guard();
--> statement-breakpoint
-- [MBX-9][PROC-001/PROC-003] Lines are part of their header, never appended to a stored document:
-- the parent row must have been inserted by this same transaction, exactly like a journal line.
-- RFQ invitees are deliberately excluded: widening the invitation set is a legitimate later action,
-- and the insert is still append-only because rfq_vendors has no update or delete path.
CREATE FUNCTION procurement_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_xmin text; parent_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'purchase_request_lines' THEN
    SELECT xmin::text, id INTO parent_xmin, parent_id FROM purchase_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.purchase_request_id;
  ELSE
    SELECT xmin::text, id INTO parent_xmin, parent_id FROM vendor_quotations WHERE tenant_id = NEW.tenant_id AND id = NEW.quotation_id;
  END IF;
  IF parent_id IS NULL OR parent_xmin <> txid_current()::text THEN
    RAISE EXCEPTION 'Procurement lines must be inserted with their new document';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_request_line_same_transaction BEFORE INSERT ON purchase_request_lines FOR EACH ROW EXECUTE FUNCTION procurement_line_guard();
CREATE TRIGGER vendor_quotation_line_same_transaction BEFORE INSERT ON vendor_quotation_lines FOR EACH ROW EXECUTE FUNCTION procurement_line_guard();
--> statement-breakpoint
-- [MBX-9][PROC-002/PROC-003] A quotation only exists for a Vendor this RFQ actually invited, so the
-- RFQ -> quotation trail cannot be forged by writing a quotation against a non-invited Vendor.
CREATE FUNCTION vendor_quotation_vendor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rfq_vendors v WHERE v.tenant_id = NEW.tenant_id AND v.rfq_id = NEW.rfq_id AND v.party_id = NEW.party_id) THEN
    RAISE EXCEPTION 'Quotation vendor was not invited to this RFQ';
  END IF;
  IF NEW.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vendor_quotations q WHERE q.tenant_id = NEW.tenant_id
    AND q.id = NEW.supersedes_id AND q.rfq_id = NEW.rfq_id AND q.party_id = NEW.party_id) THEN
    RAISE EXCEPTION 'Quotation revision must supersede the same vendor on the same RFQ';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER vendor_quotation_vendor_guard BEFORE INSERT ON vendor_quotations FOR EACH ROW EXECUTE FUNCTION vendor_quotation_vendor_guard();