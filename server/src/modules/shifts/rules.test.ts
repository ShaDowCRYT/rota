import { describe, expect, it } from "vitest";

import { setupScheduling } from "../../test/helpers.js";

const NOW = new Date("2026-11-24T00:00:00Z");

function at(day: number, hour: number, minute = 0): Date {
  const paddedDay = String(day).padStart(2, "0");
  const paddedHour = String(hour).padStart(2, "0");
  const paddedMinute = String(minute).padStart(2, "0");
  return new Date(`2027-01-${paddedDay}T${paddedHour}:${paddedMinute}:00Z`);
}

describe("shift rules", () => {
  it("rejects invalid durations and dates too far ahead", async () => {
    const context = await setupScheduling(() => NOW);
    const input = {
      assigneeId: context.users.staff.id,
      startsAt: at(1, 10),
      endsAt: at(1, 11),
    };

    await expect(
      context.shiftsService.create(context.team.id, context.users.owner.id, {
        ...input,
        endsAt: at(2, 11),
      }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid request" });

    await expect(
      context.shiftsService.create(context.team.id, context.users.owner.id, {
        ...input,
        endsAt: input.startsAt,
      }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid request" });

    await expect(
      context.shiftsService.create(context.team.id, context.users.owner.id, {
        assigneeId: context.users.staff.id,
        startsAt: new Date("2028-01-01T10:00:00Z"),
        endsAt: new Date("2028-01-01T11:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid request" });
  });

  it("rejects overlapping shifts for the same person only", async () => {
    const context = await setupScheduling(() => NOW);
    await context.shiftsService.create(context.team.id, context.users.owner.id, {
      assigneeId: context.users.staff.id,
      startsAt: at(1, 10),
      endsAt: at(1, 11),
    });

    await expect(
      context.shiftsService.create(context.team.id, context.users.owner.id, {
        assigneeId: context.users.staff.id,
        startsAt: at(1, 10),
        endsAt: at(1, 12),
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "This shift overlaps another shift for that person",
    });

    await expect(
      context.shiftsService.create(context.team.id, context.users.owner.id, {
        assigneeId: context.users.target.id,
        startsAt: at(1, 10),
        endsAt: at(1, 12),
      }),
    ).resolves.toMatchObject({ assigneeId: context.users.target.id });
  });

  it("rejects an assignee who is not a member", async () => {
    const context = await setupScheduling(() => NOW);

    await expect(
      context.shiftsService.create(context.team.id, context.users.owner.id, {
        assigneeId: context.users.nonMember.id,
        startsAt: at(1, 10),
        endsAt: at(1, 11),
      }),
    ).rejects.toMatchObject({ status: 404, message: "Team not found" });
  });

  it("enforces the list range and filters by the signed-in user", async () => {
    const context = await setupScheduling(() => NOW);
    await context.shiftsService.create(context.team.id, context.users.owner.id, {
      assigneeId: context.users.staff.id,
      startsAt: at(1, 10),
      endsAt: at(1, 11),
    });
    await context.shiftsService.create(context.team.id, context.users.owner.id, {
      assigneeId: context.users.target.id,
      startsAt: at(2, 10),
      endsAt: at(2, 11),
    });

    await expect(
      context.shiftsService.list(context.team.id, context.users.staff.id, {
        from: at(1, 0),
        to: new Date("2027-03-05T00:00:00Z"),
        mine: false,
      }),
    ).rejects.toMatchObject({ status: 400, message: "Invalid request" });

    const mine = await context.shiftsService.list(
      context.team.id,
      context.users.staff.id,
      { from: at(1, 0), to: at(15, 0), mine: true },
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.assigneeId).toBe(context.users.staff.id);

    const all = await context.shiftsService.list(
      context.team.id,
      context.users.staff.id,
      { from: at(1, 0), to: at(15, 0), mine: false },
    );
    expect(all).toHaveLength(2);
  });

  it("updates only the supplied fields and rejects new overlap", async () => {
    const context = await setupScheduling(() => NOW);
    const first = await context.shiftsService.create(
      context.team.id,
      context.users.owner.id,
      {
        assigneeId: context.users.staff.id,
        startsAt: at(1, 10),
        endsAt: at(1, 11),
      },
    );
    await context.shiftsService.create(context.team.id, context.users.owner.id, {
      assigneeId: context.users.staff.id,
      startsAt: at(1, 12),
      endsAt: at(1, 13),
    });

    await expect(
      context.shiftsService.update(
        context.team.id,
        context.users.owner.id,
        first.id,
        { startsAt: at(1, 12), endsAt: at(1, 14) },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "This shift overlaps another shift for that person",
    });

    const updated = await context.shiftsService.update(
      context.team.id,
      context.users.owner.id,
      first.id,
      { endsAt: at(1, 11, 30) },
    );
    expect(updated.startsAt).toBe(at(1, 10).toISOString());
    expect(updated.endsAt).toBe(at(1, 11, 30).toISOString());
    expect(updated.assigneeId).toBe(context.users.staff.id);
  });

  it("cancels a pending swap when the assignee changes", async () => {
    const context = await setupScheduling(() => NOW);
    const shift = await context.shiftsService.create(
      context.team.id,
      context.users.owner.id,
      {
        assigneeId: context.users.staff.id,
        startsAt: at(1, 10),
        endsAt: at(1, 11),
      },
    );
    const request = await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      shift.id,
      context.users.target.id,
    );
    context.shiftsRepository.pendingSwapIdToCancel = request.id;

    await context.shiftsService.update(
      context.team.id,
      context.users.owner.id,
      shift.id,
      { assigneeId: context.users.target.id },
    );

    expect(context.swapsRepository.requests.get(request.id)?.status).toBe(
      "cancelled",
    );
    expect(
      context.activityRepository.rows.some(
        (row) =>
          row.teamId === context.team.id &&
          row.type === "swap_cancelled" &&
          row.payload.swapRequestId === request.id,
      ),
    ).toBe(true);
  });
});
