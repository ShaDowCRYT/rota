import { randomUUID } from "node:crypto";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import { createTokenIssuer } from "../../lib/tokens.js";
import {
  createFakePasswords,
  FakeAuthRepository,
  FakeTeamsRepository,
  permissiveLimiter,
  startServer,
  testRefreshTtlDays,
  testResetTtlMinutes,
  testTokenConfig,
  unusedEmailSender,
  unusedPasswordResetRepository,
} from "../../test/helpers.js";
import { createAuthService } from "../auth/service.js";
import { createTeamsService } from "./service.js";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type Viewer = "owner" | "manager" | "staff" | "nonMember";

interface RouteIds {
  teamId: string;
  targetUserId: string;
  inviteId: string;
}

interface RouteCase {
  label: string;
  method: HttpMethod;
  path: (ids: RouteIds) => string;
  body?: unknown;
  expected: Record<Viewer, number>;
}

interface TestUser {
  id: string;
  email: string;
  token: string;
}

const inviteTtlDays = 7;

function setup() {
  const authRepository = new FakeAuthRepository();
  const teamsRepository = new FakeTeamsRepository();
  const passwords = createFakePasswords();
  const tokens = createTokenIssuer(testTokenConfig);
  const authService = createAuthService({
    repository: authRepository,
    passwords,
    tokens,
    refreshTtlDays: testRefreshTtlDays,
  });
  const teamsService = createTeamsService({
    repository: teamsRepository,
    authService,
    inviteTtlDays,
  });
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter: permissiveLimiter,
    teamsService,
    resetRepository: unusedPasswordResetRepository,
    passwords,
    emailSender: unusedEmailSender,
    resetTtlMinutes: testResetTtlMinutes,
  });

  return { authRepository, teamsRepository, tokens, teamsService, app };
}

type Context = ReturnType<typeof setup>;

async function createUser(
  context: Context,
  email: string,
): Promise<TestUser> {
  const user = await context.authRepository.createUser(email, "fake:unused");
  return { id: user.id, email: user.email, token: await context.tokens.sign(user.id) };
}

async function request(
  baseUrl: string,
  method: HttpMethod,
  path: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function seedTeam(context: Context) {
  const owner = await createUser(context, "owner@example.com");
  const manager = await createUser(context, "manager@example.com");
  const staff = await createUser(context, "staff@example.com");
  const nonMember = await createUser(context, "nonmember@example.com");
  const team = await context.teamsService.createTeam(owner.id, "Team A");

  await context.teamsRepository.createMembership(team.id, manager.id, "manager");
  await context.teamsRepository.addUserTeam(manager.id, team.id);
  await context.teamsRepository.createMembership(team.id, staff.id, "staff");
  await context.teamsRepository.addUserTeam(staff.id, team.id);

  const invite = await context.teamsService.createInvite(
    team.id,
    owner.id,
    null,
    "staff",
  );

  return { owner, manager, staff, nonMember, team, invite };
}

const routes: RouteCase[] = [
  {
    label: "GET /teams",
    method: "GET",
    path: () => "/teams",
    expected: { owner: 200, manager: 200, staff: 200, nonMember: 200 },
  },
  {
    label: "POST /teams",
    method: "POST",
    path: () => "/teams",
    body: { name: "Another team" },
    expected: { owner: 201, manager: 201, staff: 201, nonMember: 201 },
  },
  {
    label: "GET /teams/:teamId",
    method: "GET",
    path: ({ teamId }) => `/teams/${teamId}`,
    expected: { owner: 200, manager: 200, staff: 200, nonMember: 404 },
  },
  {
    label: "GET /teams/:teamId/members",
    method: "GET",
    path: ({ teamId }) => `/teams/${teamId}/members`,
    expected: { owner: 200, manager: 200, staff: 200, nonMember: 404 },
  },
  {
    label: "PATCH /teams/:teamId/members/:userId",
    method: "PATCH",
    path: ({ teamId, targetUserId }) => `/teams/${teamId}/members/${targetUserId}`,
    body: { role: "staff" },
    expected: { owner: 204, manager: 403, staff: 403, nonMember: 404 },
  },
  {
    label: "DELETE /teams/:teamId/members/:userId",
    method: "DELETE",
    path: ({ teamId, targetUserId }) => `/teams/${teamId}/members/${targetUserId}`,
    expected: { owner: 204, manager: 403, staff: 403, nonMember: 404 },
  },
  {
    label: "POST /teams/:teamId/invites",
    method: "POST",
    path: ({ teamId }) => `/teams/${teamId}/invites`,
    body: { role: "staff" },
    expected: { owner: 201, manager: 403, staff: 403, nonMember: 404 },
  },
  {
    label: "GET /teams/:teamId/invites",
    method: "GET",
    path: ({ teamId }) => `/teams/${teamId}/invites`,
    expected: { owner: 200, manager: 403, staff: 403, nonMember: 404 },
  },
  {
    label: "DELETE /teams/:teamId/invites/:inviteId",
    method: "DELETE",
    path: ({ teamId, inviteId }) => `/teams/${teamId}/invites/${inviteId}`,
    expected: { owner: 204, manager: 403, staff: 403, nonMember: 404 },
  },
];

const viewers: Viewer[] = ["owner", "manager", "staff", "nonMember"];

const cases = routes.flatMap((route) =>
  viewers.map((viewer) => ({
    label: `${route.label} as ${viewer}`,
    route,
    viewer,
    expected: route.expected[viewer],
  })),
);

describe("team route permissions", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it.each(cases)("$label returns $expected", async ({ route, viewer, expected }) => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const seeded = await seedTeam(context);

    const tokens: Record<Viewer, string> = {
      owner: seeded.owner.token,
      manager: seeded.manager.token,
      staff: seeded.staff.token,
      nonMember: seeded.nonMember.token,
    };

    const response = await request(
      started.baseUrl,
      route.method,
      route.path({
        teamId: seeded.team.id,
        targetUserId: seeded.staff.id,
        inviteId: seeded.invite.id,
      }),
      tokens[viewer],
      route.body,
    );

    expect(response.status).toBe(expected);
  });

  it("an owner cannot be demoted or removed", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const { owner, team } = await seedTeam(context);

    const demote = await request(
      started.baseUrl,
      "PATCH",
      `/teams/${team.id}/members/${owner.id}`,
      owner.token,
      { role: "staff" },
    );
    const remove = await request(
      started.baseUrl,
      "DELETE",
      `/teams/${team.id}/members/${owner.id}`,
      owner.token,
    );

    expect(demote.status).toBe(403);
    expect(await demote.json()).toEqual({ error: "Cannot change the owner" });
    expect(remove.status).toBe(403);
    expect(await remove.json()).toEqual({ error: "Cannot remove the owner" });
    expect((await context.teamsRepository.findMembership(team.id, owner.id))?.role).toBe(
      "owner",
    );
  });

  it("cross-team and non-member requests are indistinguishable from an unknown team", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const seeded = await seedTeam(context);
    const ownerB = await createUser(context, "owner-b@example.com");
    const teamB = await context.teamsService.createTeam(ownerB.id, "Team B");
    const unknownId = randomUUID();

    const probes: Array<{
      method: HttpMethod;
      path: (id: string) => string;
      body?: unknown;
    }> = [
      { method: "GET", path: (id) => `/teams/${id}` },
      { method: "GET", path: (id) => `/teams/${id}/members` },
      {
        method: "PATCH",
        path: (id) => `/teams/${id}/members/${seeded.staff.id}`,
        body: { role: "staff" },
      },
      { method: "DELETE", path: (id) => `/teams/${id}/members/${seeded.staff.id}` },
      { method: "POST", path: (id) => `/teams/${id}/invites`, body: { role: "staff" } },
      { method: "GET", path: (id) => `/teams/${id}/invites` },
      {
        method: "DELETE",
        path: (id) => `/teams/${id}/invites/${seeded.invite.id}`,
      },
    ];

    for (const probe of probes) {
      const crossTeam = await request(
        started.baseUrl,
        probe.method,
        probe.path(teamB.id),
        seeded.owner.token,
        probe.body,
      );
      const unknownTeam = await request(
        started.baseUrl,
        probe.method,
        probe.path(unknownId),
        seeded.owner.token,
        probe.body,
      );
      const outsider = await request(
        started.baseUrl,
        probe.method,
        probe.path(seeded.team.id),
        seeded.nonMember.token,
        probe.body,
      );

      expect(crossTeam.status).toBe(404);
      expect(unknownTeam.status).toBe(404);
      expect(outsider.status).toBe(404);

      const crossBody = await crossTeam.json();
      const unknownBody = await unknownTeam.json();
      const outsiderBody = await outsider.json();
      expect(crossBody).toEqual(unknownBody);
      expect(crossBody).toEqual(outsiderBody);
      expect(crossBody).toEqual({ error: "Team not found" });
    }
  });

  it("a user in both teams sees each team's own members only", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;

    const ownerA = await createUser(context, "owner-a@example.com");
    const ownerB = await createUser(context, "owner-b@example.com");
    const alice = await createUser(context, "alice@example.com");
    const bob = await createUser(context, "bob@example.com");
    const both = await createUser(context, "both@example.com");
    const teamA = await context.teamsService.createTeam(ownerA.id, "Team A");
    const teamB = await context.teamsService.createTeam(ownerB.id, "Team B");

    for (const [user, teamId, role] of [
      [alice, teamA.id, "staff"],
      [bob, teamB.id, "staff"],
      [both, teamA.id, "manager"],
      [both, teamB.id, "staff"],
    ] as const) {
      await context.teamsRepository.createMembership(teamId, user.id, role);
      await context.teamsRepository.addUserTeam(user.id, teamId);
    }

    const membersA = await request(
      started.baseUrl,
      "GET",
      `/teams/${teamA.id}/members`,
      both.token,
    );
    const membersB = await request(
      started.baseUrl,
      "GET",
      `/teams/${teamB.id}/members`,
      both.token,
    );
    const teams = await request(started.baseUrl, "GET", "/teams", both.token);
    const forbidden = await request(
      started.baseUrl,
      "GET",
      `/teams/${teamB.id}/members`,
      alice.token,
    );

    expect(membersA.status).toBe(200);
    expect(membersB.status).toBe(200);
    const emailsA = (
      (await membersA.json()) as Array<{ email: string }>
    ).map((member) => member.email);
    const emailsB = (
      (await membersB.json()) as Array<{ email: string }>
    ).map((member) => member.email);

    expect(emailsA).toContain(alice.email);
    expect(emailsA).toContain(both.email);
    expect(emailsA).not.toContain(bob.email);
    expect(emailsA).not.toContain(ownerB.email);
    expect(emailsB).toContain(bob.email);
    expect(emailsB).toContain(both.email);
    expect(emailsB).not.toContain(alice.email);
    expect(emailsB).not.toContain(ownerA.email);

    expect(teams.status).toBe(200);
    expect(await teams.json()).toEqual(
      expect.arrayContaining([
        { id: teamA.id, name: "Team A", role: "manager" },
        { id: teamB.id, name: "Team B", role: "staff" },
      ]),
    );
    expect(forbidden.status).toBe(404);
  });
});
