-- MBX-5 / ADR-009 / NFR-SEC-002: app role never owns tables or bypasses RLS.
-- DBA may pre-create this role; migrations require CREATEROLE only if it is absent.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'enginedes_app') THEN
    CREATE ROLE enginedes_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO enginedes_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_user, auth_account, auth_session, auth_verification TO enginedes_app;
GRANT SELECT ON tenants, memberships, role_grants TO enginedes_app;
GRANT SELECT, INSERT ON units, audit_events TO enginedes_app;
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON tenants TO enginedes_app
  USING (id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
-- Membership resolution is actor-scoped before tenant context is known. Actor is from a verified session.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_context ON memberships TO enginedes_app USING (
  user_id = nullif(current_setting('app.actor_id', true), '')
  OR tenant_id::text = nullif(current_setting('app.tenant_id', true), '')
);
--> statement-breakpoint
ALTER TABLE role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY grant_context ON role_grants TO enginedes_app
  USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE units FORCE ROW LEVEL SECURITY;
CREATE POLICY unit_context ON units TO enginedes_app
  USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''))
  WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_events FOR SELECT TO enginedes_app
  USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
CREATE POLICY audit_append ON audit_events FOR INSERT TO enginedes_app
  WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')
    AND actor_id = nullif(current_setting('app.actor_id', true), ''));
