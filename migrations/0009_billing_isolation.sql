CREATE TABLE "cash_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_accounts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "cash_accounts_tenant_id_unit_id_code_unique" UNIQUE("tenant_id","unit_id","code"),
	CONSTRAINT "cash_account_kind" CHECK ("cash_accounts"."kind" IN ('cash','bank'))
);
--> statement-breakpoint
CREATE TABLE "financial_document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_document_event_action" CHECK ("financial_document_events"."action" IN ('created','allocated','paid','voided','refunded'))
);
--> statement-breakpoint
CREATE TABLE "financial_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"number" text NOT NULL,
	"command_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid,
	"party_id" uuid,
	"book_date" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"outstanding" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_documents_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "financial_documents_tenant_id_type_command_id_unique" UNIQUE("tenant_id","type","command_id"),
	CONSTRAINT "financial_documents_tenant_id_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "financial_document_type" CHECK ("financial_documents"."type" IN ('invoice','bill')),
	CONSTRAINT "financial_document_status" CHECK ("financial_documents"."status" IN ('open','paid','void')),
	CONSTRAINT "financial_document_amount" CHECK ("financial_documents"."amount" > 0 AND "financial_documents"."outstanding" >= 0 AND "financial_documents"."outstanding" <= "financial_documents"."amount"),
	CONSTRAINT "financial_document_due" CHECK ("financial_documents"."due_date" >= "financial_documents"."book_date"),
	CONSTRAINT "financial_document_void" CHECK (("financial_documents"."status" = 'void') = ("financial_documents"."voided_by" IS NOT NULL)),
	CONSTRAINT "financial_document_state" CHECK (("financial_documents"."status" = 'open' AND "financial_documents"."outstanding" > 0) OR ("financial_documents"."status" = 'paid' AND "financial_documents"."outstanding" = 0) OR ("financial_documents"."status" = 'void'))
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_tenant_id_payment_id_document_id_unique" UNIQUE("tenant_id","payment_id","document_id"),
	CONSTRAINT "payment_allocation_amount" CHECK ("payment_allocations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"number" text NOT NULL,
	"command_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"location_id" uuid,
	"party_id" uuid NOT NULL,
	"cash_account_id" uuid NOT NULL,
	"book_date" date NOT NULL,
	"amount" bigint NOT NULL,
	"allocated" bigint NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"reason" text,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_tenant_id_command_id_unique" UNIQUE("tenant_id","command_id"),
	CONSTRAINT "payments_tenant_id_number_unique" UNIQUE("tenant_id","number"),
	CONSTRAINT "payment_direction" CHECK ("payments"."direction" IN ('in','out')),
	CONSTRAINT "payment_status" CHECK ("payments"."status" IN ('posted','void')),
	CONSTRAINT "payment_amount" CHECK ("payments"."amount" > 0 AND "payments"."allocated" >= 0 AND "payments"."allocated" <= "payments"."amount")
);
--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_accounts" ADD CONSTRAINT "cash_accounts_tenant_id_ledger_account_id_ledger_accounts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","ledger_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_document_events" ADD CONSTRAINT "financial_document_events_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_document_events" ADD CONSTRAINT "financial_document_events_tenant_id_document_id_financial_documents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."financial_documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_voided_by_auth_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_tenant_id_unit_id_location_id_locations_tenant_id_unit_id_id_fk" FOREIGN KEY ("tenant_id","unit_id","location_id") REFERENCES "public"."locations"("tenant_id","unit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_tenant_id_party_id_parties_tenant_id_id_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_payment_id_payments_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_document_id_financial_documents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."financial_documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_unit_id_location_id_locations_tenant_id_unit_id_id_fk" FOREIGN KEY ("tenant_id","unit_id","location_id") REFERENCES "public"."locations"("tenant_id","unit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_party_id_parties_tenant_id_id_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_cash_account_id_cash_accounts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","cash_account_id") REFERENCES "public"."cash_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;