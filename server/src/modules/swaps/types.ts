import type { SqlExecutor } from "../../db/types.js";
import type { ShiftRecord } from "../shifts/types.js";

export type SwapStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface SwapRequestRecord {
  id: string;
  teamId: string;
  shiftId: string;
  requesterId: string;
  targetId: string | null;
  status: SwapStatus;
  decidedBy: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface SwapRequestView {
  id: string;
  shiftId: string;
  requesterId: string;
  targetId: string | null;
  status: SwapStatus;
}

export interface ShiftForSwap {
  id: string;
  assigneeId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface NewSwapRequest {
  teamId: string;
  shiftId: string;
  requesterId: string;
  targetId: string | null;
}

export interface SwapListFilter {
  teamId: string;
  status?: SwapStatus;
  viewerId: string;
  isManager: boolean;
}

export type DecideOutcome =
  | { kind: "decided"; request: SwapRequestRecord; shift: ShiftRecord | undefined }
  | { kind: "already_decided" }
  | { kind: "not_found" }
  | { kind: "assignee_changed" }
  | { kind: "overlap" };

export interface SwapsRepository {
  findShiftForSwap(
    teamId: string,
    shiftId: string,
  ): Promise<ShiftForSwap | undefined>;
  lockAssignee(
    executor: SqlExecutor,
    teamId: string,
    assigneeId: string,
  ): Promise<void>;
  findOverlap(
    executor: SqlExecutor,
    teamId: string,
    assigneeId: string,
    startsAt: Date,
    endsAt: Date,
  ): Promise<boolean>;
  create(
    executor: SqlExecutor,
    input: NewSwapRequest,
  ): Promise<SwapRequestRecord>;
  find(
    teamId: string,
    requestId: string,
  ): Promise<SwapRequestRecord | undefined>;
  list(filter: SwapListFilter): Promise<SwapRequestRecord[]>;
  decide(
    executor: SqlExecutor,
    teamId: string,
    requestId: string,
    status: Exclude<SwapStatus, "pending">,
    decidedBy: string,
    assigneeId?: string,
  ): Promise<DecideOutcome>;
}

export interface SwapsService {
  request(
    teamId: string,
    userId: string,
    shiftId: string,
    targetId: string | null,
  ): Promise<SwapRequestView>;
  list(
    teamId: string,
    userId: string,
    isManager: boolean,
    status?: SwapStatus,
  ): Promise<SwapRequestView[]>;
  decide(
    teamId: string,
    userId: string,
    requestId: string,
    decision: "approved" | "rejected",
    assigneeId?: string,
  ): Promise<SwapRequestView>;
  cancel(teamId: string, userId: string, requestId: string): Promise<void>;
}
