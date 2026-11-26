import type { ActivityEvent } from './activityApi';

const MINUTE_MS = 60_000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

export function relativeTime(createdAtIso: string, nowIso: string): string {
  const elapsed = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(createdAtIso)) / MINUTE_MS));
  if (elapsed < 1) return 'just now';
  if (elapsed < HOUR_MINUTES) return `${elapsed} min ago`;
  const hours = Math.floor(elapsed / HOUR_MINUTES);
  if (elapsed < DAY_MINUTES) return `${hours} h ago`;
  return `${Math.floor(elapsed / DAY_MINUTES)} d ago`;
}

export function describeActivityEvent(
  event: ActivityEvent,
  emailById: ReadonlyMap<string, string>,
): string {
  const person = (id: unknown): string =>
    typeof id === 'string' ? (emailById.get(id) ?? 'A team member') : 'A team member';

  switch (event.type) {
    case 'shift_created':
      return `${person(event.payload.assigneeId)} was assigned a new shift`;
    case 'shift_updated':
      return `${person(event.payload.assigneeId)}'s shift was updated`;
    case 'shift_deleted':
      return `${person(event.payload.assigneeId)}'s shift was removed`;
    case 'swap_requested':
      return `${person(event.payload.requesterId)} asked to swap a shift`;
    case 'swap_approved':
      return `Swap for ${person(event.payload.requesterId)} was approved`;
    case 'swap_rejected':
      return `Swap for ${person(event.payload.requesterId)} was rejected`;
    case 'swap_cancelled':
      return `Swap request for ${person(event.payload.requesterId)} was cancelled`;
    default:
      return 'A team change happened';
  }
}
