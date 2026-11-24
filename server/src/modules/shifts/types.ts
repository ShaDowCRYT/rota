import type { SqlExecutor } from "../../db/types.js";

export interface ShiftRecord {
  id: string;
  teamId: string;
  assigneeId: string;
  startsAt: Date;
  endsAt: Date;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShiftView {
  id: string;
  assigneeId: string;
  startsAt: string;
  endsAt: string;
}

export interface ShiftTimes {
  assigneeId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface NewShift extends ShiftTimes {
  teamId: string;
  createdBy: string;
}

export interface ShiftUpdate {
  assigneeId?: string;
  startsAt?: Date;
  endsAt?: Date;
}

export interface ShiftListFilter {
  teamId: string;
  from: Date;
  to: Date;
  assigneeId?: string;
}

export interface ShiftOverlapInput extends ShiftTimes {
  teamId: string;
  excludeShiftId?: string;
}

export interface ShiftUpdateResult {
  shift: ShiftRecord;
  cancelledSwapId: string | null;
}

export interface ShiftsRepository {
  lockAssignee(
    executor: SqlExecutor,
    teamId: string,
    assigneeId: string,
  ): Promise<void>;
  findOverlap(
    executor: SqlExecutor,
    input: ShiftOverlapInput,
  ): Promise<boolean>;
  create(executor: SqlExecutor, input: NewShift): Promise<ShiftRecord>;
  find(teamId: string, shiftId: string): Promise<ShiftRecord | undefined>;
  list(filter: ShiftListFilter): Promise<ShiftRecord[]>;
  update(
    executor: SqlExecutor,
    teamId: string,
    shiftId: string,
    input: ShiftTimes,
  ): Promise<ShiftUpdateResult | undefined>;
  remove(executor: SqlExecutor, teamId: string, shiftId: string): Promise<boolean>;
}

export interface ShiftsService {
  create(
    teamId: string,
    userId: string,
    input: ShiftTimes,
  ): Promise<ShiftView>;
  list(
    teamId: string,
    userId: string,
    filter: { from: Date; to: Date; mine: boolean; assigneeId?: string },
  ): Promise<ShiftView[]>;
  update(
    teamId: string,
    userId: string,
    shiftId: string,
    input: ShiftUpdate,
  ): Promise<ShiftView>;
  remove(teamId: string, userId: string, shiftId: string): Promise<void>;
}
