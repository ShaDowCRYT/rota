import { describe, expect, it } from "vitest";

import { setupScheduling } from "../../test/helpers.js";

const NOW = new Date("2026-11-24T00:00:00Z");

function at(day: number, hour: number, minute = 0): Date {
  const paddedDay = String(day).padStart(2, "0");
  const paddedHour = String(hour).padStart(2, "0");
  const paddedMinute = String(minute).padStart(2, "0");
  return new Date(`2027-01-${paddedDay}T${paddedHour}:${paddedMinute}:00Z`);
}

async function createShift(
  context: Awaited<ReturnType<typeof setupScheduling>>,
  assigneeId: string,
) {
  return context.shiftsService.create(context.team.id, context.users.owner.id, {
    assigneeId,
    startsAt: at(1, 10),
    endsAt: at(1, 11),
  });
}

describe("swap request rules", () => {
  it("allows only the assignee to request and blocks duplicates", async () => {
    const context = await setupScheduling(() => NOW);
    const shift = await createShift(context, context.users.staff.id);

    const request = await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      shift.id,
      context.users.target.id,
    );
    expect(request).toMatchObject({
      shiftId: shift.id,
      requesterId: context.users.staff.id,
      targetId: context.users.target.id,
      status: "pending",
    });

    await expect(
      context.swapsService.request(
        context.team.id,
        context.users.staff.id,
        shift.id,
        context.users.target.id,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "A swap request is already pending",
    });

    await expect(
      context.swapsService.request(
        context.team.id,
        context.users.manager.id,
        shift.id,
        context.users.target.id,
      ),
    ).rejects.toMatchObject({ status: 403, message: "Forbidden" });
  });

  it("rejects past shifts, self targets, and non-member targets", async () => {
    const context = await setupScheduling(() => NOW);
    const shift = await createShift(context, context.users.staff.id);
    const past = await context.shiftsService.create(
      context.team.id,
      context.users.owner.id,
      {
        assigneeId: context.users.staff.id,
        startsAt: new Date("2026-11-23T10:00:00Z"),
        endsAt: new Date("2026-11-23T11:00:00Z"),
      },
    );

    await expect(
      context.swapsService.request(
        context.team.id,
        context.users.staff.id,
        past.id,
        context.users.target.id,
      ),
    ).rejects.toMatchObject({ status: 400, message: "Invalid request" });

    await expect(
      context.swapsService.request(
        context.team.id,
        context.users.staff.id,
        shift.id,
        context.users.staff.id,
      ),
    ).rejects.toMatchObject({ status: 400, message: "Invalid request" });

    await expect(
      context.swapsService.request(
        context.team.id,
        context.users.staff.id,
        shift.id,
        context.users.nonMember.id,
      ),
    ).rejects.toMatchObject({ status: 404, message: "Team not found" });

    const open = await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      shift.id,
      null,
    );
    expect(open.targetId).toBeNull();
  });

  it("shows managers all requests and staff only their own", async () => {
    const context = await setupScheduling(() => NOW);
    const staffShift = await createShift(context, context.users.staff.id);
    const targetShift = await context.shiftsService.create(
      context.team.id,
      context.users.owner.id,
      {
        assigneeId: context.users.target.id,
        startsAt: at(2, 10),
        endsAt: at(2, 11),
      },
    );

    await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      staffShift.id,
      context.users.target.id,
    );
    await context.swapsService.request(
      context.team.id,
      context.users.target.id,
      targetShift.id,
      null,
    );

    const managerRequests = await context.swapsService.list(
      context.team.id,
      context.users.manager.id,
      true,
    );
    expect(managerRequests).toHaveLength(2);

    const staffRequests = await context.swapsService.list(
      context.team.id,
      context.users.staff.id,
      false,
    );
    expect(staffRequests).toHaveLength(1);
    expect(staffRequests[0]?.requesterId).toBe(context.users.staff.id);

    const targetRequests = await context.swapsService.list(
      context.team.id,
      context.users.target.id,
      false,
      "pending",
    );
    expect(targetRequests).toHaveLength(2);
    expect(targetRequests.map((request) => request.requesterId)).toEqual(
      expect.arrayContaining([context.users.staff.id, context.users.target.id]),
    );
  });

  it("approves and records the new shift assignment", async () => {
    const context = await setupScheduling(() => NOW);
    const shift = await createShift(context, context.users.staff.id);
    const request = await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      shift.id,
      context.users.target.id,
    );

    const decided = await context.swapsService.decide(
      context.team.id,
      context.users.manager.id,
      request.id,
      "approved",
    );
    expect(decided.status).toBe("approved");
    expect(context.shiftsRepository.shifts.get(shift.id)?.assigneeId).toBe(
      context.users.target.id,
    );

    const eventTypes = context.activityRepository.rows.map((row) => row.type);
    expect(eventTypes).toContain("swap_approved");
    expect(eventTypes).toContain("shift_updated");

    await expect(
      context.swapsService.decide(
        context.team.id,
        context.users.manager.id,
        request.id,
        "approved",
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "This request was already decided",
    });
  });

  it("rejects and cancels with the expected permission checks", async () => {
    const context = await setupScheduling(() => NOW);
    const shift = await createShift(context, context.users.staff.id);
    const request = await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      shift.id,
      context.users.target.id,
    );

    const rejected = await context.swapsService.decide(
      context.team.id,
      context.users.manager.id,
      request.id,
      "rejected",
    );
    expect(rejected.status).toBe("rejected");
    await expect(
      context.swapsService.decide(
        context.team.id,
        context.users.manager.id,
        request.id,
        "rejected",
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "This request was already decided",
    });

    const secondShift = await context.shiftsService.create(
      context.team.id,
      context.users.owner.id,
      {
        assigneeId: context.users.target.id,
        startsAt: at(2, 10),
        endsAt: at(2, 11),
      },
    );
    const cancelRequest = await context.swapsService.request(
      context.team.id,
      context.users.target.id,
      secondShift.id,
      null,
    );

    await expect(
      context.swapsService.cancel(
        context.team.id,
        context.users.staff.id,
        cancelRequest.id,
      ),
    ).rejects.toMatchObject({ status: 403, message: "Forbidden" });

    await context.swapsService.cancel(
      context.team.id,
      context.users.target.id,
      cancelRequest.id,
    );
    expect(context.swapsRepository.requests.get(cancelRequest.id)?.status).toBe(
      "cancelled",
    );
    await expect(
      context.swapsService.cancel(
        context.team.id,
        context.users.target.id,
        cancelRequest.id,
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "This request was already decided",
    });
  });

  it("refuses to approve onto an overlapping shift", async () => {
    const context = await setupScheduling(() => NOW);
    const shift = await createShift(context, context.users.staff.id);
    await context.shiftsService.create(context.team.id, context.users.owner.id, {
      assigneeId: context.users.target.id,
      startsAt: at(1, 10, 30),
      endsAt: at(1, 11, 30),
    });
    const request = await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      shift.id,
      context.users.target.id,
    );

    await expect(
      context.swapsService.decide(
        context.team.id,
        context.users.manager.id,
        request.id,
        "approved",
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "This shift overlaps another shift for that person",
    });
  });

  it("refuses to approve after the shift assignee changed", async () => {
    const context = await setupScheduling(() => NOW);
    const shift = await createShift(context, context.users.staff.id);
    const request = await context.swapsService.request(
      context.team.id,
      context.users.staff.id,
      shift.id,
      context.users.target.id,
    );
    const current = context.shiftsRepository.shifts.get(shift.id);
    if (current === undefined) throw new Error("missing seeded shift");
    context.shiftsRepository.shifts.set(shift.id, {
      ...current,
      assigneeId: context.users.target.id,
    });

    await expect(
      context.swapsService.decide(
        context.team.id,
        context.users.manager.id,
        request.id,
        "approved",
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: "This shift is no longer assigned to the requester",
    });
  });
});
