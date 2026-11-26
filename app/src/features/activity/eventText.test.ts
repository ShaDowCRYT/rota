import { describe, expect, it } from 'vitest';

import type { ActivityEvent } from './activityApi';
import { describeActivityEvent, relativeTime } from './eventText';

function event(type: string, payload: Record<string, unknown>): ActivityEvent {
  return {
    id: 'event-1',
    type,
    actorId: 'user-1',
    payload,
    createdAt: '2026-01-05T09:00:00.000Z',
  };
}

const emails = new Map([
  ['user-1', 'ana@example.com'],
  ['user-2', 'ben@example.com'],
]);

describe('activity event text', () => {
  it('builds short sentences from type and payload with member emails', () => {
    expect(
      describeActivityEvent(event('shift_created', { assigneeId: 'user-2' }), emails),
    ).toBe('ben@example.com was assigned a new shift');
    expect(
      describeActivityEvent(event('swap_requested', { requesterId: 'user-2' }), emails),
    ).toBe('ben@example.com asked to swap a shift');
    expect(
      describeActivityEvent(event('shift_deleted', { assigneeId: 'user-1' }), emails),
    ).toBe('ana@example.com\'s shift was removed');
  });

  it('never reads an email from the event payload', () => {
    const result = describeActivityEvent(
      event('shift_created', { assigneeId: 'unknown-user', email: 'RAW-PAYLOAD-EMAIL' }),
      emails,
    );

    expect(result).toBe('A team member was assigned a new shift');
    expect(result).not.toContain('RAW-PAYLOAD-EMAIL');
  });

  it('uses a friendly sentence for an unknown event type', () => {
    expect(describeActivityEvent(event('something_new', {}), emails)).toBe('A team change happened');
  });

  it('formats relative time against a fixed clock', () => {
    const now = '2026-01-05T10:05:00.000Z';
    expect(relativeTime('2026-01-05T10:05:00.000Z', now)).toBe('just now');
    expect(relativeTime('2026-01-05T10:04:00.000Z', now)).toBe('1 min ago');
    expect(relativeTime('2026-01-05T08:05:00.000Z', now)).toBe('2 h ago');
    expect(relativeTime('2026-01-03T10:05:00.000Z', now)).toBe('2 d ago');
  });
});
