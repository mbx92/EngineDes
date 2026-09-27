import { describe, expect, it } from 'vitest'
import { can, readableUnits, requirePermission, type ActorAccess } from '../server/core/iam/access'

const access: ActorAccess = { userId: 'user', tenantId: 'A', membershipId: 'member', grants: [
  { role: 'admin', scope: 'unit', unitId: 'A1' },
  { role: 'operator', scope: 'unit', unitId: 'A2' },
] }
describe('[MBX-5][IAM-001/002][ORG-002] paired role and scope', () => {
  it('does not transfer admin permission from A1 into A2 or grant tenant-wide access', () => {
    expect(can(access, 'account.revoke', 'A', 'A1')).toBe(true)
    expect(can(access, 'account.revoke', 'A', 'A2')).toBe(false)
    expect(can(access, 'account.revoke', 'A')).toBe(false)
    expect(() => requirePermission(access, 'unit.create')).toThrow()
  })
  it('preserves multiple Unit assignments, without granting a third Unit or another tenant', () => {
    expect(readableUnits(access)).toEqual(['A1', 'A2'])
    expect(can(access, 'unit.read', 'A', 'A3')).toBe(false)
    expect(can(access, 'unit.read', 'B', 'A1')).toBe(false)
  })
  it('denies users with no grant; explicit tenant-wide admin grants create/revoke', () => {
    expect(can({ ...access, grants: [] }, 'unit.read', 'A')).toBe(false)
    const admin = { ...access, grants: [{ role: 'admin' as const, scope: 'tenant' as const, unitId: null }] }
    expect(can(admin, 'unit.create', 'A')).toBe(true)
    expect(readableUnits(admin)).toBeNull()
  })
  it('rejects malformed tenant scope carrying a Unit', () => {
    expect(can({ ...access, grants: [{ role: 'admin', scope: 'tenant', unitId: 'A1' }] }, 'unit.create', 'A')).toBe(false)
  })
})
