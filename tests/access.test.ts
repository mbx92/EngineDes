import { describe, expect, it } from 'vitest'
import { can, readableUnits, requirePermission, type ActorAccess } from '../server/core/iam/access'
import { domainConflictMessage } from '../server/http/context'

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
  it('allows direct activation links only for a tenant-scoped admin', () => {
    expect(can(access, 'account.activation_link', 'A')).toBe(false)
    for (const role of ['director', 'finance', 'unit_manager', 'operator', 'supervisor'] as const) {
      expect(can({ ...access, grants: [{ role, scope: 'tenant', unitId: null }] }, 'account.activation_link', 'A')).toBe(false)
    }
    const admin = { ...access, grants: [{ role: 'admin' as const, scope: 'tenant' as const, unitId: null }] }
    expect(can(admin, 'account.activation_link', 'A')).toBe(true)
    expect(can(admin, 'account.activation_link', 'B')).toBe(false)
  })
})

describe('[MBX-8][BILL-001][PAY-003] database guard refusals map to a client conflict', () => {
  it('maps a wrapped P0001 authored message instead of surfacing a 500', () => {
    expect(domainConflictMessage({ code: 'P0001', cause: { code: 'P0001', message: 'Void is not permitted once allocations exist' } }))
      .toBe('Void is not permitted once allocations exist')
    // Drizzle surfaces the driver error one level deeper; both shapes must be recognised.
    expect(domainConflictMessage({ cause: { code: 'P0001', message: 'Allocation exceeds document outstanding' } }))
      .toBe('Allocation exceeds document outstanding')
  })
  it('does not echo unrecognised constraint text and ignores unrelated errors', () => {
    expect(domainConflictMessage({ code: 'P0001', cause: { code: 'P0001', message: 'constraint "x" of relation "y" violates' } }))
      .toBe('Permintaan melanggar aturan data.')
    expect(domainConflictMessage({ code: '23505' })).toBeNull()
    expect(domainConflictMessage(new Error('boom'))).toBeNull()
  })
})
