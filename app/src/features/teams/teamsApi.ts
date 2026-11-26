import { authedFetch as defaultAuthedFetch } from '../../api/authedFetch';
import { assertUuid } from '../../api/ids';
import { ensureOk, isRecord, parseJson } from '../../api/responses';
import type { FetchLike } from '../../api/types';

import { ApiFailure } from '../auth/errors';

export const TEAM_STALE_TIME = 60_000;
export const TEAM_GC_TIME = 10 * 60_000;
export const MEMBER_STALE_TIME = 30_000;
export const MEMBER_GC_TIME = 5 * 60_000;

const LIST_TEAMS = 'GET /teams';
const CREATE_TEAM = 'POST /teams';
const GET_TEAM = 'GET /teams/:teamId';
const GET_MEMBERS = 'GET /teams/:teamId/members';
const CHANGE_ROLE = 'PATCH /teams/:teamId/members/:userId';
const REMOVE_MEMBER = 'DELETE /teams/:teamId/members/:userId';
const CREATE_INVITE = 'POST /teams/:teamId/invites';
const LIST_INVITES = 'GET /teams/:teamId/invites';
const REVOKE_INVITE = 'DELETE /teams/:teamId/invites/:inviteId';
const ACCEPT_INVITE = 'POST /invites/accept';

export type Role = 'owner' | 'manager' | 'staff';
export type InviteRole = Exclude<Role, 'owner'>;

export type Team = {
  id: string;
  name: string;
};

export type TeamSummary = Team & {
  role: Role;
};

export type MemberView = {
  id: string;
  email: string;
  role: Role;
};

export type InviteView = {
  id: string;
  email: string | null;
  role: InviteRole;
  expiresAt: string;
};

export type CreatedInvite = InviteView & {
  link: string;
};

export type CreateInviteInput = {
  email?: string;
  role: InviteRole;
};

function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'manager' || value === 'staff';
}

function isInviteRole(value: unknown): value is InviteRole {
  return value === 'manager' || value === 'staff';
}

function parseTeam(value: unknown): Team {
  if (!isRecord(value)) throw new ApiFailure(200);
  if (typeof value.id !== 'string' || typeof value.name !== 'string') throw new ApiFailure(200);
  return { id: value.id, name: value.name };
}

function parseTeamSummary(value: unknown): TeamSummary {
  if (!isRecord(value) || !isRole(value.role)) throw new ApiFailure(200);
  return { ...parseTeam(value), role: value.role };
}

function parseMember(value: unknown): MemberView {
  if (!isRecord(value)) throw new ApiFailure(200);
  if (
    typeof value.id !== 'string' ||
    typeof value.email !== 'string' ||
    !isRole(value.role)
  ) {
    throw new ApiFailure(200);
  }
  return { id: value.id, email: value.email, role: value.role };
}

function parseInvite(value: unknown, includeLink = false): InviteView | CreatedInvite {
  if (!isRecord(value)) throw new ApiFailure(200);
  if (
    typeof value.id !== 'string' ||
    (typeof value.email !== 'string' && value.email !== null) ||
    !isInviteRole(value.role) ||
    typeof value.expiresAt !== 'string'
  ) {
    throw new ApiFailure(200);
  }
  const invite: InviteView = {
    id: value.id,
    email: value.email,
    role: value.role,
    expiresAt: value.expiresAt,
  };
  if (!includeLink) return invite;
  if (typeof value.link !== 'string') throw new ApiFailure(200);
  return { ...invite, link: value.link };
}

function parseList(value: unknown, parseItem: (item: unknown) => unknown): unknown[] {
  if (!Array.isArray(value)) throw new ApiFailure(200);
  return value.map(parseItem);
}

export async function listTeams(fetcher: FetchLike = defaultAuthedFetch): Promise<TeamSummary[]> {
  const response = await fetcher('/teams', { method: 'GET' });
  await ensureOk(response, LIST_TEAMS, 'GET');
  return parseList(await parseJson(response), parseTeamSummary) as TeamSummary[];
}

export async function createTeam(
  name: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<TeamSummary> {
  const response = await fetcher('/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await ensureOk(response, CREATE_TEAM, 'POST');
  return parseTeamSummary(await parseJson(response));
}

export async function getTeam(
  teamId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<Team> {
  assertUuid(teamId, GET_TEAM, 'GET');
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}`, { method: 'GET' });
  await ensureOk(response, GET_TEAM, 'GET');
  return parseTeam(await parseJson(response));
}

export async function getMembers(
  teamId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<MemberView[]> {
  assertUuid(teamId, GET_MEMBERS, 'GET');
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}/members`, { method: 'GET' });
  await ensureOk(response, GET_MEMBERS, 'GET');
  return parseList(await parseJson(response), parseMember) as MemberView[];
}

export async function changeRole(
  teamId: string,
  userId: string,
  role: InviteRole,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<void> {
  assertUuid(teamId, CHANGE_ROLE, 'PATCH');
  assertUuid(userId, CHANGE_ROLE, 'PATCH');
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    },
  );
  await ensureOk(response, CHANGE_ROLE, 'PATCH');
}

export async function removeMember(
  teamId: string,
  userId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<void> {
  assertUuid(teamId, REMOVE_MEMBER, 'DELETE');
  assertUuid(userId, REMOVE_MEMBER, 'DELETE');
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
  await ensureOk(response, REMOVE_MEMBER, 'DELETE');
}

export async function createInvite(
  teamId: string,
  input: CreateInviteInput,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<CreatedInvite> {
  assertUuid(teamId, CREATE_INVITE, 'POST');
  const body = input.email
    ? { email: input.email, role: input.role }
    : { role: input.role };
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(response, CREATE_INVITE, 'POST');
  return parseInvite(await parseJson(response), true) as CreatedInvite;
}

export async function listInvites(
  teamId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<InviteView[]> {
  assertUuid(teamId, LIST_INVITES, 'GET');
  const response = await fetcher(`/teams/${encodeURIComponent(teamId)}/invites`, {
    method: 'GET',
  });
  await ensureOk(response, LIST_INVITES, 'GET');
  return parseList(await parseJson(response), (item) => parseInvite(item)) as InviteView[];
}

export async function revokeInvite(
  teamId: string,
  inviteId: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<void> {
  assertUuid(teamId, REVOKE_INVITE, 'DELETE');
  assertUuid(inviteId, REVOKE_INVITE, 'DELETE');
  const response = await fetcher(
    `/teams/${encodeURIComponent(teamId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' },
  );
  await ensureOk(response, REVOKE_INVITE, 'DELETE');
}

export async function acceptInvite(
  token: string,
  fetcher: FetchLike = defaultAuthedFetch,
): Promise<TeamSummary> {
  const response = await fetcher('/invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  await ensureOk(response, ACCEPT_INVITE, 'POST');
  return parseTeamSummary(await parseJson(response));
}
