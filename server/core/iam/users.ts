import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { and, eq, inArray, asc, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Transaction } from '../../database/client'
import { account, auditEvents, locations, memberships, roleGrants, roleNames, session, tenants, units, user, verification } from '../../database/schema'
import { AccessDenied, requirePermission, type ActorAccess, type Permission } from './access'

// MBX-5 / ORG-002, IAM-001/002, AUDIT-001. Identity administration is tenant scoped.
export class ManagementConflict extends Error {}
const grantInput = z.object({ role: z.enum(roleNames), scope: z.enum(['tenant', 'unit']), unitId: z.uuid().nullable(), locationId: z.uuid().nullable().default(null) }).strict()
  .refine(g => g.scope === 'tenant' ? g.unitId === null && g.locationId === null : !!g.unitId, 'Scope must match Unit/Location')
  .refine(g => g.role !== 'admin' || g.scope === 'tenant', 'Admin requires tenant scope')
export const grantsInput = z.array(grantInput).min(1).max(30).refine(grants => new Set(grants.map(g => JSON.stringify(g))).size === grants.length, 'Duplicate grants')
export const newUserInput = z.object({ name: z.string().trim().min(1).max(160), email: z.email().max(254).transform(v => v.toLowerCase()), grants: grantsInput }).strict()
const targetInput = z.string().min(1).max(128)
export const activationIdentifier = (userId: string, method: 'email' | 'manual' = 'email') => 'enginedes.activation.' + (method === 'manual' ? 'manual.' : '') + userId
export const hashActivationToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function lockAdministration(tx: Transaction, actor: ActorAccess, permission: Permission = 'account.manage', unitId?: string, locationId?: string) {
  requirePermission(actor, permission, unitId, locationId)
  await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, actor.tenantId)).for('update')
  // Recheck after the tenant lock: another administrator might have just revoked this actor.
  const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, actor.membershipId), eq(memberships.tenantId, actor.tenantId), eq(memberships.active, true)))
  if (!member) throw new AccessDenied('Actor disabled')
  const grants = await tx.select().from(roleGrants).where(and(eq(roleGrants.tenantId, actor.tenantId), eq(roleGrants.membershipId, member.id)))
  requirePermission({ ...actor, grants }, permission, unitId, locationId)
}
async function targetMember(tx: Transaction, actor: ActorAccess, targetId: string) {
  const [target] = await tx.select().from(memberships).where(and(eq(memberships.userId, targetInput.parse(targetId)), eq(memberships.tenantId, actor.tenantId)))
  if (!target) throw new AccessDenied('Target not in tenant')
  return target
}
async function validateUnits(tx: Transaction, actor: ActorAccess, grants: z.infer<typeof grantsInput>) {
  const ids = [...new Set(grants.flatMap(g => g.unitId ? [g.unitId] : []))]
  if (!ids.length) return
  const found = await tx.select({ id: units.id }).from(units).where(and(eq(units.tenantId, actor.tenantId), eq(units.active, true), inArray(units.id, ids)))
  if (found.length !== ids.length) throw new AccessDenied('Invalid Unit assignment')
  for (const grant of grants.filter(g => g.locationId)) {
    const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, actor.tenantId), eq(locations.unitId, grant.unitId!), eq(locations.id, grant.locationId!), eq(locations.active, true)))
    if (!location) throw new AccessDenied('Invalid Location assignment')
  }
}
async function audit(tx: Transaction, actor: ActorAccess, action: string, target: string, requestId: string, before: unknown, after: unknown) {
  await tx.insert(auditEvents).values({ tenantId: actor.tenantId, actorId: actor.userId, entityId: target, action, requestId, before, after })
}
async function keepAdministrator(tx: Transaction, tenantId: string) {
  const found = await tx.select({ id: memberships.id }).from(memberships).innerJoin(roleGrants, eq(roleGrants.membershipId, memberships.id))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.active, true), eq(memberships.pending, false), eq(roleGrants.role, 'admin'), eq(roleGrants.scope, 'tenant'))).limit(1)
  if (!found.length) throw new ManagementConflict('BUMDes harus memiliki minimal satu admin aktif.')
}
async function issueInvitation(tx: Transaction, userId: string, email: string, method: 'email' | 'manual' = 'email') {
  const token = randomBytes(32).toString('base64url')
  await tx.delete(verification).where(inArray(verification.identifier, [activationIdentifier(userId), activationIdentifier(userId, 'manual')]))
  await tx.insert(verification).values({ id: randomUUID(), identifier: activationIdentifier(userId, method), value: hashActivationToken(token), expiresAt: new Date(Date.now() + 86400000) })
  // Only the dedicated, audited admin-link handler may expose a manual delivery link.
  return { userId, email, token }
}
export async function listUsers(tx: Transaction, actor: ActorAccess, query: unknown) {
  requirePermission(actor, 'account.read')
  const page = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(query).page
  const rows = await tx.select({ id: user.id, name: user.name, email: user.email, active: memberships.active, pending: memberships.pending, memberId: memberships.id })
    .from(memberships).innerJoin(user, eq(memberships.userId, user.id)).where(eq(memberships.tenantId, actor.tenantId)).orderBy(asc(user.name), asc(user.id)).limit(50).offset((page - 1) * 50)
  if (!rows.length) return []
  const grants = await tx.select({ membershipId: roleGrants.membershipId, role: roleGrants.role, scope: roleGrants.scope, unitId: roleGrants.unitId, locationId: roleGrants.locationId, unitName: units.name, locationName: locations.name })
    .from(roleGrants).leftJoin(units, and(eq(units.id, roleGrants.unitId), eq(units.tenantId, roleGrants.tenantId)))
    .leftJoin(locations, and(eq(locations.id, roleGrants.locationId), eq(locations.tenantId, roleGrants.tenantId)))
    .where(and(eq(roleGrants.tenantId, actor.tenantId), inArray(roleGrants.membershipId, rows.map(r => r.memberId))))
  return rows.map(({ memberId, ...row }) => ({ ...row, grants: grants.filter(g => g.membershipId === memberId).map(({ membershipId: _id, ...g }) => g) }))
}
export async function createUser(tx: Transaction, actor: ActorAccess, input: unknown, requestId: string) {
  const data = newUserInput.parse(input)
  await lockAdministration(tx, actor, 'account.create')
  await validateUnits(tx, actor, data.grants)
  const userId = randomUUID(), memberId = randomUUID()
  await tx.insert(user).values({ id: userId, name: data.name, email: data.email })
  await tx.insert(memberships).values({ id: memberId, tenantId: actor.tenantId, userId, active: false, pending: true })
  await tx.insert(roleGrants).values(data.grants.map(g => ({ ...g, tenantId: actor.tenantId, membershipId: memberId })))
  const delivery = await issueInvitation(tx, userId, data.email)
  await audit(tx, actor, 'account.created', userId, requestId, null, { pending: true, grants: data.grants })
  return delivery
}
export async function resendInvitation(tx: Transaction, actor: ActorAccess, targetId: string, requestId: string) {
  await lockAdministration(tx, actor)
  const target = await targetMember(tx, actor, targetId)
  if (!target.pending) throw new ManagementConflict('Akun sudah diaktivasi atau undangan tidak tersedia.')
  const [identity] = await tx.select({ email: user.email }).from(user).where(eq(user.id, target.userId))
  if (!identity) throw new AccessDenied('Identity missing')
  const delivery = await issueInvitation(tx, target.userId, identity.email)
  await audit(tx, actor, 'account.invitation_reissued', targetId, requestId, null, { expiresInHours: 24 })
  return delivery
}
// IAM-001/002, AUDIT-001: bypass SMTP delivery only; the recipient still activates.
export async function issueManualActivation(tx: Transaction, actor: ActorAccess, targetId: string, requestId: string) {
  await lockAdministration(tx, actor, 'account.activation_link')
  const target = await targetMember(tx, actor, targetId)
  if (!target.pending || target.active) throw new ManagementConflict('Akun tidak sedang menunggu aktivasi.')
  const [identity] = await tx.select({ email: user.email }).from(user).where(eq(user.id, target.userId))
  if (!identity) throw new AccessDenied('Identity missing')
  const delivery = await issueInvitation(tx, target.userId, identity.email, 'manual')
  await audit(tx, actor, 'account.activation_link_issued', targetId, requestId, null, { delivery: 'manual', expiresInHours: 24 })
  return { userId: delivery.userId, token: delivery.token }
}
export async function updateGrants(tx: Transaction, actor: ActorAccess, targetId: string, input: unknown, requestId: string) {
  const { grants } = z.object({ grants: grantsInput }).strict().parse(input)
  await lockAdministration(tx, actor)
  const target = await targetMember(tx, actor, targetId)
  await validateUnits(tx, actor, grants)
  const before = await tx.select({ role: roleGrants.role, scope: roleGrants.scope, unitId: roleGrants.unitId, locationId: roleGrants.locationId }).from(roleGrants).where(and(eq(roleGrants.tenantId, actor.tenantId), eq(roleGrants.membershipId, target.id)))
  await tx.delete(roleGrants).where(and(eq(roleGrants.tenantId, actor.tenantId), eq(roleGrants.membershipId, target.id)))
  await tx.insert(roleGrants).values(grants.map(g => ({ ...g, tenantId: actor.tenantId, membershipId: target.id })))
  await keepAdministrator(tx, actor.tenantId)
  await audit(tx, actor, 'account.grants_updated', targetId, requestId, { grants: before }, { grants })
  return { updated: true }
}
export async function setAccountActive(tx: Transaction, actor: ActorAccess, targetId: string, input: unknown, requestId: string) {
  const { active } = z.object({ active: z.boolean() }).strict().parse(input)
  await lockAdministration(tx, actor)
  const target = await targetMember(tx, actor, targetId)
  if (target.pending) throw new ManagementConflict('Pengguna harus mengaktivasi akun melalui email terlebih dahulu.')
  await tx.update(memberships).set({ active }).where(and(eq(memberships.id, target.id), eq(memberships.tenantId, actor.tenantId)))
  await keepAdministrator(tx, actor.tenantId)
  if (!active) await tx.delete(session).where(eq(session.userId, targetId))
  await audit(tx, actor, 'account.status_updated', targetId, requestId, { active: target.active }, { active })
  return { updated: true }
}
