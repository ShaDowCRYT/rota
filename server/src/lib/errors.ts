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
