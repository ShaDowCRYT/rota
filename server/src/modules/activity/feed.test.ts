import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { fakeExecutor, setupScheduling } from "../../test/helpers.js";

function encodeCursor(time: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: time, i: id })).toString("base64url");
}

describe("activity feed", () => {
  it("walks every event once using keyset pagination", async () => {
    const context = await setupScheduling();

    for (let index = 0; index < 5; index += 1) {
      await context.activityService.record(fakeExecutor, {
        teamId: context.team.id,
        type: "shift_created",
        actorId: context.users.owner.id,
        payload: { index },
      });
    }
    for (let index = 0; index < 3; index += 1) {
      await context.activityService.record(fakeExecutor, {
        teamId: context.otherTeam.id,
        type: "shift_created",
        actorId: context.users.nonMember.id,
        payload: { index },
      });
    }

    const first = await context.activityService.list(context.team.id, undefined, 2);
    expect(first.items.map((item) => item.payload.index)).toEqual([4, 3]);
    expect(first.nextCursor).not.toBeNull();

    const second = await context.activityService.list(
      context.team.id,
      first.nextCursor ?? undefined,
      2,
    );
    expect(second.items.map((item) => item.payload.index)).toEqual([2, 1]);
    expect(second.nextCursor).not.toBeNull();

    const third = await context.activityService.list(
      context.team.id,
      second.nextCursor ?? undefined,
      2,
    );
    expect(third.items.map((item) => item.payload.index)).toEqual([0]);
    expect(third.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items, ...third.items].map(
      (item) => item.id,
    );
    expect(new Set(ids).size).toBe(5);
  });

  it("rejects malformed cursors", async () => {
    const context = await setupScheduling();

    await expect(
      context.activityService.list(context.team.id, "not-a-cursor!", 20),
    ).rejects.toMatchObject({ status: 400, message: "Invalid cursor" });

    await expect(
      context.activityService.list(
        context.team.id,
        encodeCursor("not-a-time", randomUUID()),
        20,
      ),
    ).rejects.toMatchObject({ status: 400, message: "Invalid cursor" });

    await expect(
      context.activityService.list(
        context.team.id,
        encodeCursor("2026-01-01 00:00:00.000001+00", "not-a-uuid"),
        20,
      ),
    ).rejects.toMatchObject({ status: 400, message: "Invalid cursor" });
  });

  it("keeps the exact database timestamp text in the cursor", async () => {
    const context = await setupScheduling();

    await context.activityService.record(fakeExecutor, {
      teamId: context.team.id,
      type: "shift_created",
      actorId: context.users.owner.id,
      payload: { index: 1 },
    });
    await context.activityService.record(fakeExecutor, {
      teamId: context.team.id,
      type: "shift_created",
      actorId: context.users.owner.id,
      payload: { index: 2 },
    });

    const page = await context.activityService.list(context.team.id, undefined, 1);
    expect(page.nextCursor).not.toBeNull();

    const decoded = JSON.parse(
      Buffer.from(page.nextCursor ?? "", "base64url").toString("utf8"),
    ) as { t: string; i: string };
    expect(decoded.t).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}\+00$/,
    );

    const iso = decoded.t.replace(" ", "T").replace("+00", "Z");
    await expect(
      context.activityService.list(
        context.team.id,
        encodeCursor(iso, decoded.i),
        20,
      ),
    ).rejects.toMatchObject({ status: 400, message: "Invalid cursor" });
  });

  it("accepts whole-second database timestamp text", async () => {
    const context = await setupScheduling();

    await context.activityService.record(fakeExecutor, {
      teamId: context.team.id,
      type: "shift_created",
      actorId: context.users.owner.id,
      payload: { index: 1 },
    });
    await context.activityService.record(fakeExecutor, {
      teamId: context.team.id,
      type: "shift_created",
      actorId: context.users.owner.id,
      payload: { index: 2 },
    });

    const page = await context.activityService.list(context.team.id, undefined, 1);
    expect(page.nextCursor).not.toBeNull();

    const decoded = JSON.parse(
      Buffer.from(page.nextCursor ?? "", "base64url").toString("utf8"),
    ) as { t: string; i: string };
    const wholeSecond = decoded.t.replace(/\.\d{6}/, "");

    await expect(
      context.activityService.list(
        context.team.id,
        encodeCursor(wholeSecond, decoded.i),
        20,
      ),
    ).resolves.toMatchObject({ items: [], nextCursor: null });
  });
});
