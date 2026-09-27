ALTER TABLE "memberships" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- MBX-5 / IAM-001/002, ADR-009: Core controls account writes; RLS constrains tenant ownership.
GRANT INSERT, UPDATE ON memberships TO enginedes_app;
GRANT INSERT, DELETE ON role_grants TO enginedes_app;
GRANT UPDATE (name) ON tenants TO enginedes_app;
DROP POLICY membership_context ON memberships;
CREATE POLICY membership_context ON memberships FOR SELECT TO enginedes_app USING (
  user_id = nullif(current_setting('app.actor_id', true), '')
  OR tenant_id::text = nullif(current_setting('app.tenant_id', true), '')
);
CREATE POLICY membership_insert ON memberships FOR INSERT TO enginedes_app
  WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY membership_update ON memberships FOR UPDATE TO enginedes_app
  USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
