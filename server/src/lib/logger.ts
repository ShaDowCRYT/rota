type LogFields = Record<string, unknown>;

function write(
  stream: NodeJS.WriteStream,
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
): void {
  stream.write(
    `${JSON.stringify({
      level,
      message,
      time: new Date().toISOString(),
      ...fields,
    })}\n`,
  );
}

export const logger = {
  info: (message: string, fields?: LogFields) =>
    write(process.stdout, "info", message, fields),
  warn: (message: string, fields?: LogFields) =>
    write(process.stdout, "warn", message, fields),
  error: (message: string, fields?: LogFields) =>
    write(process.stderr, "error", message, fields),
};
