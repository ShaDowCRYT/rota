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
  createSchedulingHarness,
  testTokenConfig,
  testTransactionRunner,
  unusedEmailSender,
  unusedPasswordResetRepository,
  unusedBillingService,
} from "../../test/helpers.js";
import { createAuthService } from "../auth/service.js";
import { createTeamsService } from "./service.js";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type Viewer = "owner" | "manager" | "staff" | "nonMember";

type MemberViewer = Exclude<Viewer, "nonMember">;

interface RouteIds {
  teamId: string;
  targetUserId: string;
  inviteId: string;
  shiftId: string;
  shiftIds: Record<MemberViewer, string>;
  freeShiftIds: Record<MemberViewer, string>;
  swapRequestIds: Record<MemberViewer, string>;
}

interface RouteCase {
  label: string;
  method: HttpMethod;
  path: (ids: RouteIds, viewer: Viewer) => string;
  body?: unknown | ((ids: RouteIds, viewer: Viewer) => unknown);
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
  const scheduling = createSchedulingHarness(teamsService);
  const app = createApp({
    checkDatabase: () => Promise.resolve(),
    checkRedis: () => Promise.resolve(true),
    authService,
    limiter: permissiveLimiter,
    teamsService,
    billingService: unusedBillingService,
    activityService: scheduling.activityService,
    shiftsService: scheduling.shiftsService,
    swapsService: scheduling.swapsService,
    resetRepository: unusedPasswordResetRepository,
    passwords,
    emailSender: unusedEmailSender,
    resetTtlMinutes: testResetTtlMinutes,
    trustProxyHops: 0,
  });

  return { authRepository, teamsRepository, tokens, teamsService,
    billingService: unusedBillingService, scheduling, app };
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

  const members: Record<MemberViewer, TestUser> = { owner, manager, staff };
  const shiftIds = {} as Record<MemberViewer, string>;
  const freeShiftIds = {} as Record<MemberViewer, string>;
  const swapRequestIds = {} as Record<MemberViewer, string>;
  const base = Date.parse("2027-01-01T10:00:00Z");
  const hour = 60 * 60 * 1000;

  for (const [index, memberViewer] of (["owner", "manager", "staff"] as const).entries()) {
    const member = members[memberViewer];
    const startsAt = new Date(base + index * 2 * hour);
    const shift = await testTransactionRunner(team.id, (executor) =>
      context.scheduling.shiftsRepository.create(executor, {
        teamId: team.id,
        assigneeId: member.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + hour),
        createdBy: owner.id,
      }),
    );
    shiftIds[memberViewer] = shift.id;

    const swapRequest = await testTransactionRunner(team.id, (executor) =>
      context.scheduling.swapsRepository.create(executor, {
        teamId: team.id,
        shiftId: shift.id,
        requesterId: member.id,
        targetId: null,
      }),
    );
    swapRequestIds[memberViewer] = swapRequest.id;

    const freeStartsAt = new Date(base + (index + 4) * 2 * hour);
    const freeShift = await testTransactionRunner(team.id, (executor) =>
      context.scheduling.shiftsRepository.create(executor, {
        teamId: team.id,
        assigneeId: member.id,
        startsAt: freeStartsAt,
        endsAt: new Date(freeStartsAt.getTime() + hour),
        createdBy: owner.id,
      }),
    );
    freeShiftIds[memberViewer] = freeShift.id;
  }

  return {
    owner,
    manager,
    staff,
    nonMember,
    team,
    invite,
    shiftId: shiftIds.owner,
    shiftIds,
    freeShiftIds,
    swapRequestIds,
  };
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
  {
    label: "GET /teams/:teamId/activity",
    method: "GET",
    path: ({ teamId }) => `/teams/${teamId}/activity`,
    expected: { owner: 200, manager: 200, staff: 200, nonMember: 404 },
  },
  {
    label: "GET /teams/:teamId/shifts",
    method: "GET",
    path: ({ teamId }) =>
      `/teams/${teamId}/shifts?from=2027-01-01T00:00:00Z&to=2027-02-15T00:00:00Z`,
    expected: { owner: 200, manager: 200, staff: 200, nonMember: 404 },
  },
  {
    label: "POST /teams/:teamId/shifts",
    method: "POST",
    path: ({ teamId }) => `/teams/${teamId}/shifts`,
    body: ({ targetUserId }: RouteIds) => ({
      assigneeId: targetUserId,
      startsAt: "2027-05-01T10:00:00Z",
      endsAt: "2027-05-01T11:00:00Z",
    }),
    expected: { owner: 201, manager: 201, staff: 403, nonMember: 404 },
  },
  {
    label: "PATCH /teams/:teamId/shifts/:shiftId",
    method: "PATCH",
    path: ({ teamId, shiftId }) => `/teams/${teamId}/shifts/${shiftId}`,
    body: {
      startsAt: "2027-01-01T12:00:00Z",
      endsAt: "2027-01-01T13:00:00Z",
    },
    expected: { owner: 200, manager: 200, staff: 403, nonMember: 404 },
  },
  {
    label: "DELETE /teams/:teamId/shifts/:shiftId",
    method: "DELETE",
    path: ({ teamId, shiftId }) => `/teams/${teamId}/shifts/${shiftId}`,
    expected: { owner: 204, manager: 204, staff: 403, nonMember: 404 },
  },
  {
    label: "POST /teams/:teamId/shifts/:shiftId/swap-requests",
    method: "POST",
    path: (ids, viewer) =>
      `/teams/${ids.teamId}/shifts/${
        ids.freeShiftIds[viewer === "nonMember" ? "owner" : viewer]
      }/swap-requests`,
    expected: { owner: 201, manager: 201, staff: 201, nonMember: 404 },
  },
  {
    label: "GET /teams/:teamId/swap-requests",
    method: "GET",
    path: ({ teamId }) => `/teams/${teamId}/swap-requests`,
    expected: { owner: 200, manager: 200, staff: 200, nonMember: 404 },
  },
  {
    label: "POST /teams/:teamId/swap-requests/:requestId/approve",
    method: "POST",
    path: ({ teamId, swapRequestIds }) =>
      `/teams/${teamId}/swap-requests/${swapRequestIds.owner}/approve`,
    body: ({ targetUserId }: RouteIds) => ({ assigneeId: targetUserId }),
    expected: { owner: 200, manager: 200, staff: 403, nonMember: 404 },
  },
  {
    label: "POST /teams/:teamId/swap-requests/:requestId/reject",
    method: "POST",
    path: ({ teamId, swapRequestIds }) =>
      `/teams/${teamId}/swap-requests/${swapRequestIds.owner}/reject`,
    expected: { owner: 200, manager: 200, staff: 403, nonMember: 404 },
  },
  {
    label: "POST /teams/:teamId/swap-requests/:requestId/cancel",
    method: "POST",
    path: (ids, viewer) =>
      `/teams/${ids.teamId}/swap-requests/${
        ids.swapRequestIds[viewer === "nonMember" ? "owner" : viewer]
      }/cancel`,
    expected: { owner: 204, manager: 204, staff: 204, nonMember: 404 },
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

    const ids: RouteIds = {
      teamId: seeded.team.id,
      targetUserId: seeded.staff.id,
      inviteId: seeded.invite.id,
      shiftId: seeded.shiftId,
      shiftIds: seeded.shiftIds,
      freeShiftIds: seeded.freeShiftIds,
      swapRequestIds: seeded.swapRequestIds,
    };
    const body =
      typeof route.body === "function" ? route.body(ids, viewer) : route.body;
    const response = await request(
      started.baseUrl,
      route.method,
      route.path(ids, viewer),
      tokens[viewer],
      body,
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
      { method: "GET", path: (id) => `/teams/${id}/activity` },
      {
        method: "GET",
        path: (id) =>
          `/teams/${id}/shifts?from=2027-01-01T00:00:00Z&to=2027-02-15T00:00:00Z`,
      },
      {
        method: "POST",
        path: (id) => `/teams/${id}/shifts`,
        body: {
          assigneeId: seeded.staff.id,
          startsAt: "2027-05-01T10:00:00Z",
          endsAt: "2027-05-01T11:00:00Z",
        },
      },
      {
        method: "PATCH",
        path: (id) => `/teams/${id}/shifts/${seeded.shiftId}`,
        body: {
          startsAt: "2027-01-01T12:00:00Z",
          endsAt: "2027-01-01T13:00:00Z",
        },
      },
      {
        method: "DELETE",
        path: (id) => `/teams/${id}/shifts/${seeded.shiftId}`,
      },
      {
        method: "POST",
        path: (id) =>
          `/teams/${id}/shifts/${seeded.freeShiftIds.owner}/swap-requests`,
      },
      { method: "GET", path: (id) => `/teams/${id}/swap-requests` },
      {
        method: "POST",
        path: (id) =>
          `/teams/${id}/swap-requests/${seeded.swapRequestIds.owner}/approve`,
        body: { assigneeId: seeded.staff.id },
      },
      {
        method: "POST",
        path: (id) =>
          `/teams/${id}/swap-requests/${seeded.swapRequestIds.owner}/reject`,
      },
      {
        method: "POST",
        path: (id) =>
          `/teams/${id}/swap-requests/${seeded.swapRequestIds.owner}/cancel`,
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


