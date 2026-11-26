import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "../../lib/opaqueToken.js";
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
  unusedActivityService,
  unusedEmailSender,
  unusedPasswordResetRepository,
  unusedShiftsService,
  unusedSwapsService,
  unusedBillingService,
} from "../../test/helpers.js";
import { createAuthService } from "../auth/service.js";
import { createTeamsService } from "./service.js";
import type { CreatedInvite, InviteRecord } from "./types.js";

type HttpMethod = "POST" | "GET" | "DELETE";

interface TestUser {
  id: string;
  email: string;
  token: string;
}

interface InvalidCase {
  label: string;
  status: 400 | 403;
  accepter: "invitee" | "other";
  unknownToken?: boolean;
  mutate?: (invite: InviteRecord) => void;
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
    billingService: unusedBillingService,
    activityService: unusedActivityService,
    shiftsService: unusedShiftsService,
    swapsService: unusedSwapsService,
    resetRepository: unusedPasswordResetRepository,
    passwords,
    emailSender: unusedEmailSender,
    resetTtlMinutes: testResetTtlMinutes,
    trustProxyHops: 0,
  });

  return { authRepository, teamsRepository, tokens, teamsService,
    billingService: unusedBillingService, app };
}

type Context = ReturnType<typeof setup>;

async function createUser(context: Context, email: string): Promise<TestUser> {
  const user = await context.authRepository.createUser(email, "fake:unused");
  return {
    id: user.id,
    email: user.email,
    token: await context.tokens.sign(user.id),
  };
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

function tokenFromLink(link: string): string {
  expect(link.startsWith("rota://invite?token=")).toBe(true);
  const token = new URL(link).searchParams.get("token");
  if (token === null || token.length === 0) {
    throw new Error("expected an invite token in the link");
  }
  return token;
}

function inviteById(context: Context, id: string): InviteRecord {
  const invite = context.teamsRepository.invites.get(id);
  if (invite === undefined) throw new Error("expected an invite record");
  return invite;
}

async function seed(context: Context) {
  const owner = await createUser(context, "owner@example.com");
  const invitee = await createUser(context, "invitee@example.com");
  const other = await createUser(context, "other@example.com");
  const manager = await createUser(context, "manager@example.com");
  const staff = await createUser(context, "staff@example.com");
  const team = await context.teamsService.createTeam(owner.id, "Invited Team");

  await context.teamsRepository.createMembership(team.id, manager.id, "manager");
  await context.teamsRepository.addUserTeam(manager.id, team.id);
  await context.teamsRepository.createMembership(team.id, staff.id, "staff");
  await context.teamsRepository.addUserTeam(staff.id, team.id);

  return { owner, invitee, other, manager, staff, team };
}

async function createInvite(
  baseUrl: string,
  ownerToken: string,
  teamId: string,
  body: { email?: string; role: "manager" | "staff" },
): Promise<{ invite: CreatedInvite; token: string }> {
  const response = await request(
    baseUrl,
    "POST",
    `/teams/${teamId}/invites`,
    ownerToken,
    body,
  );
  expect(response.status).toBe(201);
  const invite = (await response.json()) as CreatedInvite;
  return { invite, token: tokenFromLink(invite.link) };
}

async function acceptInvite(
  baseUrl: string,
  userToken: string,
  inviteToken: string,
): Promise<Response> {
  return request(baseUrl, "POST", "/invites/accept", userToken, {
    token: inviteToken,
  });
}

const invalidCases: InvalidCase[] = [
  { label: "wrong email", status: 403, accepter: "other" },
  { label: "unknown token", status: 400, accepter: "invitee", unknownToken: true },
  {
    label: "expired invite",
    status: 400,
    accepter: "invitee",
    mutate: (invite) => {
      invite.expiresAt = new Date(Date.now() - 1000);
    },
  },
  {
    label: "revoked invite",
    status: 400,
    accepter: "invitee",
    mutate: (invite) => {
      invite.revokedAt = new Date();
    },
  },
  {
    label: "used invite",
    status: 400,
    accepter: "invitee",
    mutate: (invite) => {
      invite.usedAt = new Date();
    },
  },
];

describe("invite lifecycle", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const running = server;
    server = undefined;
    if (running === undefined) return;
    await new Promise<void>((resolve, reject) => {
      running.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("an owner invite exposes the raw token only in its link", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const { owner, team } = await seed(context);

    const { invite, token } = await createInvite(
      started.baseUrl,
      owner.token,
      team.id,
      { email: "invitee@example.com", role: "staff" },
    );

    expect(Object.keys(invite).sort()).toEqual([
      "email",
      "expiresAt",
      "id",
      "link",
      "role",
    ]);
    expect(invite.id).toEqual(expect.any(String));
    expect(invite.email).toBe("invitee@example.com");
    expect(invite.role).toBe("staff");
    expect(Date.parse(invite.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(invite.expiresAt)).toBeLessThan(
      Date.now() + (inviteTtlDays + 1) * 24 * 60 * 60 * 1000,
    );

    const serialized = JSON.stringify(invite);
    expect(serialized.split(token)).toHaveLength(2);
    expect(serialized).not.toContain(hashOpaqueToken(token));

    const stored = inviteById(context, invite.id);
    expect(stored.tokenHash).toBe(hashOpaqueToken(token));
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.teamId).toBe(team.id);
    expect(stored.invitedBy).toBe(owner.id);
  });

  it("listing invites never exposes a token or token hash", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const { owner, team } = await seed(context);
    const { invite, token } = await createInvite(
      started.baseUrl,
      owner.token,
      team.id,
      { email: "invitee@example.com", role: "staff" },
    );

    const response = await request(
      started.baseUrl,
      "GET",
      `/teams/${team.id}/invites`,
      owner.token,
    );

    expect(response.status).toBe(200);
    const listed = (await response.json()) as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([
      "email",
      "expiresAt",
      "id",
      "role",
    ]);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(listed)).not.toContain(hashOpaqueToken(token));
    expect(listed[0]?.id).toBe(invite.id);
  });

  it.each(invalidCases)(
    "$label returns $status with a generic error and leaves the invite state unchanged",
    async (caseItem) => {
      const context = setup();
      const started = await startServer(context.app);
      server = started.server;
      const { owner, invitee, other, team } = await seed(context);
      const { invite, token } = await createInvite(
        started.baseUrl,
        owner.token,
        team.id,
        { email: "invitee@example.com", role: "staff" },
      );
      caseItem.mutate?.(inviteById(context, invite.id));
      const usedBefore = inviteById(context, invite.id).usedAt;

      const accepter = caseItem.accepter === "invitee" ? invitee : other;
      const presented = caseItem.unknownToken === true ? generateOpaqueToken() : token;
      const response = await acceptInvite(started.baseUrl, accepter.token, presented);

      expect(response.status).toBe(caseItem.status);
      expect(await response.json()).toEqual({ error: "Invalid or expired invite" });
      expect(inviteById(context, invite.id).usedAt).toEqual(usedBefore);
      expect(
        await context.teamsRepository.findMembership(team.id, accepter.id),
      ).toBeUndefined();
    },
  );

  it("an existing member gets 409 and the invite stays unused", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const { owner, team } = await seed(context);
    const { invite, token } = await createInvite(
      started.baseUrl,
      owner.token,
      team.id,
      { email: owner.email, role: "manager" },
    );

    const response = await acceptInvite(started.baseUrl, owner.token, token);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Already a member" });
    expect(inviteById(context, invite.id).usedAt).toBeNull();
    expect((await context.teamsRepository.findMembership(team.id, owner.id))?.role).toBe(
      "owner",
    );
    expect(
      context.teamsRepository.userTeams.filter(
        (entry) => entry.userId === owner.id && entry.teamId === team.id,
      ),
    ).toHaveLength(1);
  });

  it("a link-only invite accepts for the signed-in user with any email", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const { owner, other, team } = await seed(context);
    const { invite, token } = await createInvite(
      started.baseUrl,
      owner.token,
      team.id,
      { role: "manager" },
    );

    expect(invite.email).toBeNull();

    const response = await acceptInvite(started.baseUrl, other.token, token);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: team.id,
      name: team.name,
      role: "manager",
    });
    expect((await context.teamsRepository.findMembership(team.id, other.id))?.role).toBe(
      "manager",
    );
    expect(context.teamsRepository.userTeams).toContainEqual({
      userId: other.id,
      teamId: team.id,
    });
    expect(inviteById(context, invite.id).usedAt).toBeInstanceOf(Date);

    const second = await acceptInvite(started.baseUrl, other.token, token);
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: "Invalid or expired invite" });
  });

  it("an accepted email invite writes the membership and lookup with the invited role", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const { owner, invitee, team } = await seed(context);
    const { token } = await createInvite(
      started.baseUrl,
      owner.token,
      team.id,
      { email: "INVITEE@EXAMPLE.COM", role: "staff" },
    );

    const response = await acceptInvite(started.baseUrl, invitee.token, token);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: team.id,
      name: team.name,
      role: "staff",
    });
    expect((await context.teamsRepository.findMembership(team.id, invitee.id))?.role).toBe(
      "staff",
    );
    expect(context.teamsRepository.userTeams).toContainEqual({
      userId: invitee.id,
      teamId: team.id,
    });

    const teams = await request(started.baseUrl, "GET", "/teams", invitee.token);
    expect(teams.status).toBe(200);
    const summaries = (await teams.json()) as Array<{
      id: string;
      name: string;
      role: string;
    }>;
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries).toContainEqual({
      id: team.id,
      name: team.name,
      role: "staff",
    });
    expect(
      summaries.every(
        (summary) =>
          summary.id === team.id &&
          summary.name === team.name &&
          summary.role === "staff",
      ),
    ).toBe(true);
  });

  it("managers and staff cannot create, list, or revoke invites", async () => {
    const context = setup();
    const started = await startServer(context.app);
    server = started.server;
    const { owner, manager, staff, team } = await seed(context);
    const { invite } = await createInvite(
      started.baseUrl,
      owner.token,
      team.id,
      { role: "staff" },
    );

    for (const viewer of [manager, staff]) {
      const create = await request(
        started.baseUrl,
        "POST",
        `/teams/${team.id}/invites`,
        viewer.token,
        { role: "staff" },
      );
      const list = await request(
        started.baseUrl,
        "GET",
        `/teams/${team.id}/invites`,
        viewer.token,
      );
      const revoke = await request(
        started.baseUrl,
        "DELETE",
        `/teams/${team.id}/invites/${invite.id}`,
        viewer.token,
      );

      expect(create.status).toBe(403);
      expect(list.status).toBe(403);
      expect(revoke.status).toBe(403);
    }
  });
});


