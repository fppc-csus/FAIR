import { primaryClientOrigin } from '../middleware/clientOrigin.js';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from './prisma.js';
import { supabase } from './supabase.js';

export const accessError = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
export const normalizeEmail = value => String(value ?? '').trim().toLowerCase();
export const hashInvitation = value => createHash('sha256').update(value).digest('hex');
const validRole = role => ['owner', 'admin'].includes(role);
const invitationSelect = { id: true, email: true, role: true, status: true, expiresAt: true, lastError: true, createdAt: true };

// All permission mutations use the same transaction lock. In particular two
// simultaneous demotions cannot both pass the last-owner check.
export function withAccessLock(work, db = prisma) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(700, 1)`;
    return work(tx);
  });
}

export async function membershipFor(user, db = prisma) {
  const member = await db.adminMember.findUnique({ where: { userId: user.id } });
  if (member) return member.active ? member : null;
  return withAccessLock(async tx => {
    // Recheck after acquiring the lock, including disabled memberships.
    const existing = await tx.adminMember.findUnique({ where: { userId: user.id } });
    if (existing) return existing.active ? existing : null;
    if (await tx.adminAccessState.findUnique({ where: { id: 1 } })) return null;
    const email = normalizeEmail(process.env.FAIR_ADMIN_EMAIL);
    if (!email) throw accessError(503, 'The first owner has not been configured.');
    if (!user.email_confirmed_at || normalizeEmail(user.email) !== email) return null;
    if (await tx.adminMember.count()) throw accessError(503, 'Admin access initialization needs operator review.');
    const owner = await tx.adminMember.create({ data: { userId: user.id, email, role: 'owner' } });
    await tx.adminAccessState.create({ data: { id: 1 } });
    await tx.adminAccessAudit.create({ data: { actorId: user.id, action: 'owner_bootstrapped', target: user.id } });
    return owner;
  }, db);
}

async function assertOwner(tx, actorId) {
  const actor = await tx.adminMember.findUnique({ where: { userId: actorId } });
  if (!actor?.active || actor.role !== 'owner') throw accessError(403, 'Only an active owner can manage users.');
}

export async function changeMember(actorId, userId, changes, db = prisma) {
  if (!changes || Object.keys(changes).some(key => !['role', 'active'].includes(key)) ||
      (!('role' in changes) && !('active' in changes)) ||
      ('role' in changes && !validRole(changes.role)) || ('active' in changes && typeof changes.active !== 'boolean')) {
    throw accessError(400, 'Provide a valid role and/or active status.');
  }
  return withAccessLock(async tx => {
    await assertOwner(tx, actorId);
    const member = await tx.adminMember.findUnique({ where: { userId } });
    if (!member) throw accessError(404, 'User membership not found.');
    if (member.active && member.role === 'owner' && (changes.active === false || changes.role === 'admin')) {
      const owners = await tx.adminMember.count({ where: { active: true, role: 'owner' } });
      if (owners <= 1) throw accessError(409, 'The last active owner cannot be disabled or demoted.');
    }
    const updated = await tx.adminMember.update({ where: { userId }, data: changes });
    await tx.adminAccessAudit.create({ data: { actorId, action: 'membership_changed', target: userId, details: { before: { role: member.role, active: member.active }, after: changes } } });
    return updated;
  }, db);
}

function setupUrl(token) {
  const origin = primaryClientOrigin();
  let url;
  try { url = new URL('/admin/account', origin); } catch { throw accessError(503, 'Set CLIENT_ORIGIN to the frontend URL before sending invitations.'); }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw accessError(503, 'Invitation redirects require a secure frontend URL.');
  }
  url.searchParams.set('invitation', token);
  return url.href;
}

export async function sendInvitation(actorId, input, db = prisma, auth = supabase.auth) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !validRole(input.role)) throw accessError(400, 'Enter a valid email and role.');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashInvitation(token);
  const redirectTo = setupUrl(token);
  const invitation = await withAccessLock(async tx => {
    await assertOwner(tx, actorId);
    const deliveries = await tx.adminAccessAudit.count({ where: { actorId, action: 'invitation_requested', createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (deliveries >= 10) throw accessError(429, 'Invitation limit reached. Try again in an hour.');
    if (await tx.adminMember.findUnique({ where: { email } })) throw accessError(409, 'This user already has a membership. Manage their role or access instead.');
    const previous = input.id ? await tx.adminInvitation.findUnique({ where: { id: input.id } }) : null;
    if (input.id && (!previous || previous.email !== email || !['pending', 'delivery_failed', 'sending'].includes(previous.status))) throw accessError(409, 'This invitation cannot be resent.');
    const pending = await tx.adminInvitation.findFirst({ where: { email, status: { in: ['pending', 'sending', 'delivery_failed'] } } });
    if (!input.id && pending) throw accessError(409, 'An invitation already exists. Resend or revoke it.');
    if (previous?.status === 'sending' && Date.now() - previous.updatedAt.getTime() < 60_000) throw accessError(409, 'Invitation delivery is still in progress.');
    const data = { email, role: input.role, tokenHash, status: 'sending', invitedBy: actorId, expiresAt: new Date(Date.now() + 48 * 3600_000), lastError: null };
    const row = previous ? await tx.adminInvitation.update({ where: { id: previous.id }, data }) : await tx.adminInvitation.create({ data });
    await tx.adminAccessAudit.create({ data: { actorId, action: 'invitation_requested', target: row.id, details: { email, role: input.role } } });
    return row;
  }, db);

  // Email and DB writes cannot share a transaction. Persist the attempt first,
  // never activate membership here, and report partial delivery explicitly.
  let failure = null;
  try {
    let result = await auth.admin.inviteUserByEmail(email, { redirectTo });
    if (result.error?.code === 'email_exists' || result.error?.code === 'user_already_exists') {
      result = await auth.resetPasswordForEmail(email, { redirectTo });
    }
    if (result.error) failure = 'Email delivery failed. Check Supabase SMTP and redirect configuration, then resend.';
  } catch { failure = 'Email delivery could not be confirmed. Check email configuration and resend.'; }
  try {
    await db.adminInvitation.updateMany({ where: { id: invitation.id, tokenHash, status: 'sending' }, data: { status: failure ? 'delivery_failed' : 'pending', lastError: failure } });
    await db.adminAccessAudit.create({ data: { actorId, action: failure ? 'invitation_delivery_failed' : 'invitation_sent', target: invitation.id } });
  } catch { throw accessError(503, 'The invitation attempt was recorded, but delivery status could not be saved. Refresh Users before retrying. No access was granted.'); }
  return db.adminInvitation.findUnique({ where: { id: invitation.id }, select: invitationSelect });
}

export async function revokeInvitation(actorId, id, db = prisma) {
  return withAccessLock(async tx => {
    await assertOwner(tx, actorId);
    const row = await tx.adminInvitation.findUnique({ where: { id } });
    if (!row || !['pending', 'sending', 'delivery_failed'].includes(row.status)) throw accessError(409, 'This invitation cannot be revoked.');
    await tx.adminInvitation.update({ where: { id }, data: { status: 'revoked' } });
    await tx.adminAccessAudit.create({ data: { actorId, action: 'invitation_revoked', target: id } });
  }, db);
}

export async function acceptInvitation(user, token, db = prisma) {
  if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) throw accessError(400, 'Invalid invitation link.');
  return withAccessLock(async tx => {
    const invitation = await tx.adminInvitation.findUnique({ where: { tokenHash: hashInvitation(token) } });
    if (!invitation || invitation.status !== 'pending' || invitation.expiresAt <= new Date()) throw accessError(410, 'This invitation is expired, revoked, or already used. Ask an owner to resend it.');
    if (!user.email_confirmed_at || normalizeEmail(user.email) !== invitation.email) throw accessError(403, 'Sign in with the verified email this invitation was sent to.');
    const existing = await tx.adminMember.findUnique({ where: { userId: user.id } });
    if (existing || await tx.adminMember.findUnique({ where: { email: invitation.email } })) throw accessError(409, 'An owner must manage this existing membership.');
    // A demoted/disabled inviter must not leave behind usable invitations.
    await assertOwner(tx, invitation.invitedBy);
    const member = await tx.adminMember.create({ data: { userId: user.id, email: invitation.email, role: invitation.role, grantedBy: invitation.invitedBy } });
    await tx.adminInvitation.update({ where: { id: invitation.id }, data: { status: 'accepted' } });
    await tx.adminAccessAudit.create({ data: { actorId: user.id, action: 'invitation_accepted', target: invitation.id } });
    return member;
  }, db);
}

export async function listAccess(db = prisma) {
  const [members, invitations, audit] = await Promise.all([
    db.adminMember.findMany({ orderBy: { createdAt: 'asc' } }),
    db.adminInvitation.findMany({ select: invitationSelect, orderBy: { createdAt: 'desc' }, take: 100 }),
    db.adminAccessAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  return { members, invitations, audit };
}

export function invitationById(id, db = prisma) {
  return db.adminInvitation.findUnique({ where: { id }, select: invitationSelect });
}