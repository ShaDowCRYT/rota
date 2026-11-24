export function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  throw new Error("Invalid timestamp");
}

export function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}
