export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class HttpError extends Error {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    message: string,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.headers = headers;
  }
}

export function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  );
}

export function getPostgresErrorCode(error: unknown): string | undefined {
  let current = error;
  const visited = new Set<unknown>();

  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== "object" || visited.has(current)) {
      return undefined;
    }
    visited.add(current);

    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") {
      return record.code;
    }
    current = record.cause;
  }

  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return getPostgresErrorCode(error) === "23505";
}
