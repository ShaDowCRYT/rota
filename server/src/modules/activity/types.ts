import type { SqlExecutor } from "../../db/types.js";

export interface ActivityEventInput {
  teamId: string;
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
}

export interface ActivityEventView {
  id: string;
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityEventView[];
  nextCursor: string | null;
}

export interface ActivityRow {
  id: string;
  type: string;
  actorId: string;
  payload: Record<string, unknown>;
  createdAtText: string;
  createdAtDate: Date;
}

export interface ActivityRepository {
  append(executor: SqlExecutor, event: ActivityEventInput): Promise<void>;
  list(
    teamId: string,
    cursorTimeText: string | undefined,
    cursorId: string | undefined,
    limit: number,
  ): Promise<{ rows: ActivityRow[]; hasMore: boolean }>;
  cursorTimeIsValid(teamId: string, text: string): Promise<boolean>;
}

export interface ActivityService {
  list(
    teamId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ActivityPage>;
  record(executor: SqlExecutor, event: ActivityEventInput): Promise<void>;
}
