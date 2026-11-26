import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../api/types';
import { fakeResponse, TEST_IDS } from '../../test/fakes';
import { ApiFailure, mapError } from '../auth/errors';
import * as teamsApi from './teamsApi';

type Call = { path: string; init?: RequestInit };

function makeFetcher(status: number, body: unknown): { fetcher: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: FetchLike = async (path, init) => {
    calls.push({ path, init });
    return fakeResponse({ status, body });
  };
  return { fetcher, calls };
}

async function expectNoRequest(action: (fetcher: FetchLike) => Promise<unknown>) {
  const { fetcher, calls } = makeFetcher(200, null);
  await expect(action(fetcher)).rejects.toMatchObject({ status: 0 });
  expect(calls).toHaveLength(0);
}

describe('teamsApi', () => {
  it('lists teams with GET /teams', async () => {
    const { fetcher, calls } = makeFetcher(200, [
      { id: TEST_IDS.team, name: 'Team One', role: 'owner' },
    ]);

    const result = await teamsApi.listTeams(fetcher);

    expect(result).toEqual([{ id: TEST_IDS.team, name: 'Team One', role: 'owner' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/teams');
    expect(calls[0].init?.method).toBe('GET');
  });

  it('lists members with GET /teams/:teamId/members', async () => {
    const { fetcher, calls } = makeFetcher(200, [
      { id: TEST_IDS.user, email: 'manager@example.com', role: 'manager' },
    ]);

    const result = await teamsApi.getMembers(TEST_IDS.team, fetcher);

    expect(result).toEqual([
      { id: TEST_IDS.user, email: 'manager@example.com', role: 'manager' },
    ]);
    expect(calls[0].path).toBe(`/teams/${TEST_IDS.team}/members`);
    expect(calls[0].init?.method).toBe('GET');
  });

  it('creates a team with the trimmed name in the body', async () => {
    const { fetcher, calls } = makeFetcher(201, {
      id: TEST_IDS.team,
      name: 'Team One',
      role: 'owner',
    });

    const result = await teamsApi.createTeam('Team One', fetcher);

    expect(result.role).toBe('owner');
    expect(calls[0].path).toBe('/teams');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: 'Team One' });
  });

  it('surfaces 404 and 403 as status failures', async () => {
    const missing = makeFetcher(404, { error: 'Team not found' });
    await expect(teamsApi.getTeam(TEST_IDS.team, missing.fetcher)).rejects.toMatchObject({
      status: 404,
    });

    const forbidden = makeFetcher(403, { error: 'Forbidden' });
    await expect(teamsApi.getMembers(TEST_IDS.team, forbidden.fetcher)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('maps 404 to a safe message without raw server text', () => {
    const message = mapError(new ApiFailure(404), 'team').message;

    expect(message).toBe('Not found');
    expect(message).not.toContain('RAW-TEAM-DETAIL-MUST-NOT-SHOW');
  });

  it('changes a role with PATCH and the exact body', async () => {
    const { fetcher, calls } = makeFetcher(204, null);

    await teamsApi.changeRole(TEST_IDS.team, TEST_IDS.user, 'manager', fetcher);

    expect(calls[0].path).toBe(`/teams/${TEST_IDS.team}/members/${TEST_IDS.user}`);
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ role: 'manager' });
  });

  it('creates an invite with the chosen role and optional email', async () => {
    const link = 'rota://invite?token=abcdefghijklmnopqrstuvwxyz012345';
    const { fetcher, calls } = makeFetcher(201, {
      id: TEST_IDS.invite,
      email: 'person@example.com',
      role: 'staff',
      expiresAt: '2026-12-01T00:00:00.000Z',
      link,
    });

    const result = await teamsApi.createInvite(
      TEST_IDS.team,
      { email: 'person@example.com', role: 'staff' },
      fetcher,
    );

    expect(result.link).toBe(link);
    expect(calls[0].path).toBe(`/teams/${TEST_IDS.team}/invites`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      email: 'person@example.com',
      role: 'staff',
    });
  });

  it('creates a link-only invite when email is omitted', async () => {
    const link = 'rota://invite';
    const { fetcher, calls } = makeFetcher(201, {
      id: TEST_IDS.invite,
      email: null,
      role: 'manager',
      expiresAt: '2026-12-01T00:00:00.000Z',
      link,
    });

    const result = await teamsApi.createInvite(TEST_IDS.team, { role: 'manager' }, fetcher);

    expect(result.email).toBeNull();
    expect(result.link).toBe(link);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ role: 'manager' });
  });

  it('lists invites without returning a link', async () => {
    const { fetcher } = makeFetcher(200, [
      {
        id: TEST_IDS.invite,
        email: null,
        role: 'manager',
        expiresAt: '2026-12-01T00:00:00.000Z',
        link: 'rota://invite?token=abcdefghijklmnopqrstuvwxyz012345',
      },
    ]);

    const result = await teamsApi.listInvites(TEST_IDS.team, fetcher);

    expect(result).toEqual([
      {
        id: TEST_IDS.invite,
        email: null,
        role: 'manager',
        expiresAt: '2026-12-01T00:00:00.000Z',
      },
    ]);
  });

  it('accepts an invite with the token in the body and maps 409', async () => {
    const token = 'invite-token-value-abcdefghijklmnop';
    const accepted = makeFetcher(201, {
      id: TEST_IDS.team,
      name: 'Team One',
      role: 'staff',
    });

    const result = await teamsApi.acceptInvite(token, accepted.fetcher);

    expect(result.role).toBe('staff');
    expect(accepted.calls[0].path).toBe('/invites/accept');
    expect(JSON.parse(String(accepted.calls[0].init?.body))).toEqual({ token });

    const duplicate = makeFetcher(409, { error: 'Already a member' });
    await expect(teamsApi.acceptInvite(token, duplicate.fetcher)).rejects.toBeInstanceOf(ApiFailure);
  });

  it('removes a member with DELETE and maps 404 without raw text', async () => {
    const removed = makeFetcher(204, null);
    await teamsApi.removeMember(TEST_IDS.team, TEST_IDS.user, removed.fetcher);

    expect(removed.calls[0].path).toBe(`/teams/${TEST_IDS.team}/members/${TEST_IDS.user}`);
    expect(removed.calls[0].init?.method).toBe('DELETE');

    const missing = makeFetcher(404, { error: 'RAW-MEMBER-DETAIL-MUST-NOT-SHOW' });
    await expect(
      teamsApi.removeMember(TEST_IDS.team, TEST_IDS.user, missing.fetcher),
    ).rejects.toMatchObject({ status: 404 });
    expect(mapError(new ApiFailure(404), 'team').message).not.toContain(
      'RAW-MEMBER-DETAIL-MUST-NOT-SHOW',
    );
  });

  it('revokes an invite with DELETE and keeps the link out of the list', async () => {
    const revoked = makeFetcher(204, null);
    await teamsApi.revokeInvite(TEST_IDS.team, TEST_IDS.invite, revoked.fetcher);

    expect(revoked.calls[0].path).toBe(
      `/teams/${TEST_IDS.team}/invites/${TEST_IDS.invite}`,
    );
    expect(revoked.calls[0].init?.method).toBe('DELETE');
  });

  it('rejects every non-UUID team id before sending a request', async () => {
    await expectNoRequest((fetcher) => teamsApi.getTeam('undefined', fetcher));
    await expectNoRequest((fetcher) => teamsApi.getTeam('', fetcher));
    await expectNoRequest((fetcher) => teamsApi.getMembers('team-1', fetcher));
    await expectNoRequest((fetcher) =>
      teamsApi.changeRole('team-1', TEST_IDS.user, 'manager', fetcher),
    );
    await expectNoRequest((fetcher) =>
      teamsApi.changeRole(TEST_IDS.team, 'user-2', 'manager', fetcher),
    );
    await expectNoRequest((fetcher) => teamsApi.removeMember('team-1', TEST_IDS.user, fetcher));
    await expectNoRequest((fetcher) =>
      teamsApi.createInvite('team-1', { role: 'staff' }, fetcher),
    );
    await expectNoRequest((fetcher) => teamsApi.listInvites('team-1', fetcher));
    await expectNoRequest((fetcher) => teamsApi.revokeInvite('team-1', TEST_IDS.invite, fetcher));
    await expectNoRequest((fetcher) =>
      teamsApi.revokeInvite(TEST_IDS.team, 'invite-1', fetcher),
    );
  });
});
