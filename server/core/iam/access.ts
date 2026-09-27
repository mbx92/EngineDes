// MBX-5 / IAM-001/002, ORG-002, NFR-SEC-001/002. Grants preserve role/scope pairing.
export type Role = 'admin' | 'director' | 'finance' | 'unit_manager' | 'operator' | 'supervisor'
export type Permission = 'unit.read' | 'unit.create' | 'account.revoke' | 'account.read' | 'account.create' | 'account.manage' | 'organization.update'
export type Grant = { role: Role; scope: 'tenant' | 'unit'; unitId: string | null }
export interface ActorAccess { userId: string; tenantId: string; membershipId: string; grants: Grant[] }

export class AccessDenied extends Error {}
const permissions: Record<Role, readonly Permission[]> = {
  admin: ['unit.read', 'unit.create', 'account.revoke', 'account.read', 'account.create', 'account.manage', 'organization.update'],
  director: ['unit.read'], finance: ['unit.read'], unit_manager: ['unit.read'],
  operator: ['unit.read'], supervisor: ['unit.read'],
}
export function can(access: ActorAccess, permission: Permission, tenantId: string, unitId?: string): boolean {
  if (access.tenantId !== tenantId) return false
  return access.grants.some(grant => permissions[grant.role].includes(permission)
    && (grant.scope === 'tenant' ? grant.unitId === null : !!unitId && grant.unitId === unitId))
}
export function requirePermission(access: ActorAccess, permission: Permission, unitId?: string): void {
  if (!can(access, permission, access.tenantId, unitId)) throw new AccessDenied('Permission or scope denied')
}
export function readableUnits(access: ActorAccess): string[] | null {
  if (can(access, 'unit.read', access.tenantId)) return null
  return [...new Set(access.grants.filter(g => g.scope === 'unit' && g.unitId
    && can(access, 'unit.read', access.tenantId, g.unitId)).map(g => g.unitId!))]
}
