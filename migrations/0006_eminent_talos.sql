CREATE TABLE "accounting_mapping_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_mapping_revisions_tenant_id_event_type_schema_version_revision_unique" UNIQUE("tenant_id","event_type","schema_version","revision")
);
--> statement-breakpoint
CREATE TABLE "accounting_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"revision" integer NOT NULL,
	"rules" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_mappings_tenant_id_event_type_schema_version_unique" UNIQUE("tenant_id","event_type","schema_version"),
	CONSTRAINT "mapping_version" CHECK ("accounting_mappings"."schema_version" > 0 AND "accounting_mappings"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "accounting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" text NOT NULL,
	CONSTRAINT "accounting_periods_tenant_id_month_unique" UNIQUE("tenant_id","month"),
	CONSTRAINT "accounting_period_month" CHECK ("accounting_periods"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"debit" bigint NOT NULL,
	"credit" bigint NOT NULL,
	CONSTRAINT "journal_lines_tenant_id_journal_id_line_no_unique" UNIQUE("tenant_id","journal_id","line_no"),
	CONSTRAINT "journal_line_side" CHECK (("journal_lines"."debit" > 0 AND "journal_lines"."credit" = 0) OR ("journal_lines"."credit" > 0 AND "journal_lines"."debit" = 0)),
	CONSTRAINT "journal_line_no" CHECK ("journal_lines"."line_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"mapping_revision" integer,
	"book_date" date NOT NULL,
	"kind" text NOT NULL,
	"corrects_id" uuid,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journals_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "journals_tenant_id_event_id_unique" UNIQUE("tenant_id","event_id"),
	CONSTRAINT "journal_kind" CHECK ("journals"."kind" IN ('normal','reversal','adjustment')),
	CONSTRAINT "journal_version" CHECK ("journals"."schema_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_accounts_tenant_id_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "ledger_account_kind" CHECK ("ledger_accounts"."kind" IN ('asset','liability','equity','revenue','expense'))
);
--> statement-breakpoint
ALTER TABLE "accounting_mapping_revisions" ADD CONSTRAINT "accounting_mapping_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_mapping_revisions" ADD CONSTRAINT "accounting_mapping_revisions_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_mappings" ADD CONSTRAINT "accounting_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_closed_by_auth_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_journal_id_journals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","journal_id") REFERENCES "public"."journals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_account_id_ledger_accounts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_tenant_id_corrects_id_journals_tenant_id_id_fk" FOREIGN KEY ("tenant_id","corrects_id") REFERENCES "public"."journals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;