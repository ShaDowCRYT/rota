import { ApiFailure } from '../features/auth/errors';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function readRouteId(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function resolveTeamIdParam(value: unknown): string | undefined {
  const teamId = readRouteId(value);
  return isUuid(teamId) ? teamId : undefined;
}

export function assertUuid(value: unknown, endpoint: string, method: string): void {
  if (!isUuid(value)) {
    throw new ApiFailure(0, undefined, undefined, endpoint, method);
  }
}
