// MBX-5 / IAM-001/002, ORG-002, NFR-SEC-001/002. Grants preserve role/scope pairing.
export type Role = 'admin' | 'director' | 'finance' | 'unit_manager' | 'operator' | 'procurement' | 'supervisor'
export type Permission = 'unit.read' | 'unit.create' | 'account.revoke' | 'account.read' | 'account.create' | 'account.manage' | 'account.activation_link' | 'organization.update' | 'location.manage' | 'party.read' | 'party.manage' | 'configuration.manage' | 'audit.read' | 'transaction.context' | 'approval.authorize' | 'financial.read' | 'financial.post' | 'financial.configure' | 'period.close' | 'procurement.read' | 'purchase_request.create' | 'rfq.create' | 'quotation.create'
export type Grant = { role: Role; scope: 'tenant' | 'unit'; unitId: string | null; locationId?: string | null }
export interface ActorAccess { userId: string; tenantId: string; membershipId: string; grants: Grant[] }

export class AccessDenied extends Error {}
// [MBX-9][IAM-001/002] Procurement follows the Personas page: Kepala Unit may raise a PR inside
// assigned Unit Usaha, and the `procurement` persona also runs RFQ/quotation. Visibility
// (procurement.read) is separate from the create actions, so a read-only Pengawas is possible.
const permissions: Record<Role, readonly Permission[]> = {
  admin: ['unit.read', 'unit.create', 'account.revoke', 'account.read', 'account.create', 'account.manage', 'account.activation_link', 'organization.update', 'location.manage', 'party.read', 'party.manage', 'configuration.manage', 'audit.read', 'financial.configure', 'financial.read', 'procurement.read'],
  director: ['unit.read', 'party.read', 'transaction.context', 'approval.authorize', 'financial.read', 'period.close', 'procurement.read'], finance: ['unit.read', 'party.read', 'transaction.context', 'financial.read', 'financial.post', 'period.close'],
  unit_manager: ['unit.read', 'party.read', 'transaction.context', 'procurement.read', 'purchase_request.create'], operator: ['unit.read', 'party.read', 'transaction.context'],
  procurement: ['unit.read', 'party.read', 'transaction.context', 'procurement.read', 'purchase_request.create', 'rfq.create', 'quotation.create'],
  supervisor: ['unit.read', 'party.read', 'audit.read', 'procurement.read'],
}
export function can(access: ActorAccess, permission: Permission, tenantId: string, unitId?: string, locationId?: string): boolean {
  if (access.tenantId !== tenantId) return false
  return access.grants.some(grant => permissions[grant.role].includes(permission)
    && (grant.scope === 'tenant' ? grant.unitId === null && !grant.locationId : !!unitId && grant.unitId === unitId && (!grant.locationId || grant.locationId === locationId)))
}
export function requirePermission(access: ActorAccess, permission: Permission, unitId?: string, locationId?: string): void {
  if (!can(access, permission, access.tenantId, unitId, locationId)) throw new AccessDenied('Permission or scope denied')
}
export function readableUnits(access: ActorAccess): string[] | null {
  if (can(access, 'unit.read', access.tenantId)) return null
  return [...new Set(access.grants.filter(g => g.scope === 'unit' && g.unitId
    && can(access, 'unit.read', access.tenantId, g.unitId, g.locationId || undefined)).map(g => g.unitId!))]
}
