CREATE TABLE "configuration_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"revision" integer NOT NULL,
	"value" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configuration_revisions_tenant_id_key_revision_unique" UNIQUE("tenant_id","key","revision")
);
--> statement-breakpoint
CREATE TABLE "configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"revision" integer NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "configurations_tenant_id_key_unique" UNIQUE("tenant_id","key"),
	CONSTRAINT "configuration_revision" CHECK ("configurations"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"command_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"number" text NOT NULL,
	"configuration_revision" integer NOT NULL,
	"unit_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_numbers_tenant_id_type_command_id_unique" UNIQUE("tenant_id","type","command_id"),
	CONSTRAINT "document_numbers_tenant_id_number_unique" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_tenant_id_unit_id_id_unique" UNIQUE("tenant_id","unit_id","id"),
	CONSTRAINT "locations_tenant_id_unit_id_code_unique" UNIQUE("tenant_id","unit_id","code")
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parties_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "parties_tenant_id_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "party_kind" CHECK ("parties"."kind" IN ('person','organization'))
);
--> statement-breakpoint
CREATE TABLE "party_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	"unit_id" uuid,
	CONSTRAINT "party_role" CHECK ("party_roles"."role" IN ('customer','vendor','employee'))
);
--> statement-breakpoint
CREATE TABLE "sequence_counters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "sequence_counters_tenant_id_key_unique" UNIQUE("tenant_id","key"),
	CONSTRAINT "sequence_positive" CHECK ("sequence_counters"."value" > 0)
);
--> statement-breakpoint
ALTER TABLE "role_grants" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "configuration_revisions" ADD CONSTRAINT "configuration_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configuration_revisions" ADD CONSTRAINT "configuration_revisions_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "configurations" ADD CONSTRAINT "configurations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_numbers" ADD CONSTRAINT "document_numbers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_numbers" ADD CONSTRAINT "document_numbers_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_tenant_id_party_id_parties_tenant_id_id_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "public"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_roles" ADD CONSTRAINT "party_roles_tenant_id_unit_id_units_tenant_id_id_fk" FOREIGN KEY ("tenant_id","unit_id") REFERENCES "public"."units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_counters" ADD CONSTRAINT "sequence_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_tenant_id_unit_id_location_id_locations_tenant_id_unit_id_id_fk" FOREIGN KEY ("tenant_id","unit_id","location_id") REFERENCES "public"."locations"("tenant_id","unit_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "location_requires_unit" CHECK ("role_grants"."location_id" IS NULL OR "role_grants"."unit_id" IS NOT NULL);