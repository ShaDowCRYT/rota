import { HttpError } from "../../lib/errors.js";
import type { ActivityRepository, ActivityService } from "./types.js";

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const timestampTextPattern =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalidCursor(): HttpError {
  return new HttpError(400, "Invalid cursor");
}

function decodeCursor(cursor: string): { time: string; id: string } {
  if (!base64UrlPattern.test(cursor)) {
    throw invalidCursor();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw invalidCursor();
  }

  const record = parsed as Record<string, unknown>;
  const time = record.t;
  const id = record.i;

  if (
    typeof time !== "string" ||
    !timestampTextPattern.test(time) ||
    typeof id !== "string" ||
    !uuidPattern.test(id)
  ) {
    throw invalidCursor();
  }

  return { time, id };
}

function encodeCursor(time: string, id: string): string {
  return Buffer.from(JSON.stringify({ t: time, i: id })).toString("base64url");
}

export function createActivityService(
  repository: ActivityRepository,
): ActivityService {
  return {
    async list(teamId, cursor, limit) {
      const decoded = cursor === undefined ? undefined : decodeCursor(cursor);

      if (
        decoded !== undefined &&
        !(await repository.cursorTimeIsValid(teamId, decoded.time))
      ) {
        throw invalidCursor();
      }

      const { rows, hasMore } = await repository.list(
        teamId,
        decoded?.time,
        decoded?.id,
        limit,
      );

      const last = rows[rows.length - 1];
      return {
        items: rows.map((row) => ({
          id: row.id,
          type: row.type,
          actorId: row.actorId,
          payload: row.payload,
          createdAt: row.createdAtDate.toISOString(),
        })),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor(last.createdAtText, last.id)
            : null,
      };
    },

    record(executor, event) {
      return repository.append(executor, event);
    },
  };
}
