-- [MBX-5][NFR-SEC-002][AUDIT-001] Tenant isolation and append-only history.
--> statement-breakpoint
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON locations TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE parties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON parties TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE party_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON party_roles TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON configurations TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE configuration_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON configuration_revisions TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE sequence_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON sequence_counters TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
ALTER TABLE document_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_numbers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_context ON document_numbers TO enginedes_app USING (tenant_id::text = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id::text = nullif(current_setting('app.tenant_id', true), ''));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON locations, parties, configurations, sequence_counters TO enginedes_app;
GRANT SELECT, INSERT, DELETE ON party_roles TO enginedes_app;
GRANT SELECT, INSERT ON configuration_revisions, document_numbers TO enginedes_app;
--> statement-breakpoint
CREATE UNIQUE INDEX party_roles_context ON party_roles (tenant_id, party_id, role, COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
