import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../api/types';
import { fakeResponse } from '../../test/fakes';
import { ApiFailure } from '../auth/errors';
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

describe('teamsApi', () => {
  it('lists teams with GET /teams', async () => {
    const { fetcher, calls } = makeFetcher(200, [{ id: 'team-1', name: 'Team One', role: 'owner' }]);

    const result = await teamsApi.listTeams(fetcher);

    expect(result).toEqual([{ id: 'team-1', name: 'Team One', role: 'owner' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/teams');
    expect(calls[0].init?.method).toBe('GET');
  });

  it('creates a team with the trimmed name in the body', async () => {
    const { fetcher, calls } = makeFetcher(201, { id: 'team-1', name: 'Team One', role: 'owner' });

    const result = await teamsApi.createTeam('Team One', fetcher);

    expect(result.role).toBe('owner');
    expect(calls[0].path).toBe('/teams');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ name: 'Team One' });
  });

  it('surfaces 404 and 403 as status failures', async () => {
    const missing = makeFetcher(404, { error: 'Team not found' });
    await expect(teamsApi.getTeam('team-1', missing.fetcher)).rejects.toMatchObject({
      status: 404,
    });

    const forbidden = makeFetcher(403, { error: 'Forbidden' });
    await expect(teamsApi.getMembers('team-1', forbidden.fetcher)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('changes a role with PATCH and the exact body', async () => {
    const { fetcher, calls } = makeFetcher(204, null);

    await teamsApi.changeRole('team-1', 'user-2', 'manager', fetcher);

    expect(calls[0].path).toBe('/teams/team-1/members/user-2');
    expect(calls[0].init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ role: 'manager' });
  });

  it('creates an invite with the chosen role and optional email', async () => {
    const link = 'rota://invite?token=abcdefghijklmnopqrstuvwxyz012345';
    const { fetcher, calls } = makeFetcher(201, {
      id: 'invite-1',
      email: 'person@example.com',
      role: 'staff',
      expiresAt: '2026-12-01T00:00:00.000Z',
      link,
    });

    const result = await teamsApi.createInvite(
      'team-1',
      { email: 'person@example.com', role: 'staff' },
      fetcher,
    );

    expect(result.link).toBe(link);
    expect(calls[0].path).toBe('/teams/team-1/invites');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      email: 'person@example.com',
      role: 'staff',
    });
  });

  it('lists invites without returning a link', async () => {
    const { fetcher } = makeFetcher(200, [
      {
        id: 'invite-1',
        email: null,
        role: 'manager',
        expiresAt: '2026-12-01T00:00:00.000Z',
        link: 'rota://invite?token=abcdefghijklmnopqrstuvwxyz012345',
      },
    ]);

    const result = await teamsApi.listInvites('team-1', fetcher);

    expect(result).toEqual([
      {
        id: 'invite-1',
        email: null,
        role: 'manager',
        expiresAt: '2026-12-01T00:00:00.000Z',
      },
    ]);
  });

  it('accepts an invite with the token in the body and maps 409', async () => {
    const token = 'invite-token-value-abcdefghijklmnop';
    const accepted = makeFetcher(201, { id: 'team-1', name: 'Team One', role: 'staff' });

    const result = await teamsApi.acceptInvite(token, accepted.fetcher);

    expect(result.role).toBe('staff');
    expect(accepted.calls[0].path).toBe('/invites/accept');
    expect(JSON.parse(String(accepted.calls[0].init?.body))).toEqual({ token });

    const duplicate = makeFetcher(409, { error: 'Already a member' });
    await expect(teamsApi.acceptInvite(token, duplicate.fetcher)).rejects.toBeInstanceOf(ApiFailure);
  });
});
