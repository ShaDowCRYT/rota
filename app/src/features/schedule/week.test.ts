import { describe, expect, it } from 'vitest';

import {
  calendarDaysFrom,
  formatLocalTime,
  formatShiftWindow,
  formatWeekRange,
  getWeekRange,
  groupShiftsByDay,
  localDateKey,
  localDateTimeToIso,
  shiftWeek,
  type WeekShift,
} from './week';

const utcWeek = getWeekRange('2026-01-01T12:00:00.000Z', 'UTC');

describe('week helpers', () => {
  it('uses Monday as the first day across a year boundary', () => {
    expect(utcWeek.start).toBe('2025-12-29T00:00:00.000Z');
    expect(utcWeek.end).toBe('2026-01-05T00:00:00.000Z');
    expect(utcWeek.days).toHaveLength(7);
  });

  it('moves to the previous and next week across a year boundary', () => {
    expect(shiftWeek(utcWeek, 'UTC', -1).start).toBe('2025-12-22T00:00:00.000Z');
    expect(shiftWeek(utcWeek, 'UTC', 1).start).toBe('2026-01-05T00:00:00.000Z');
  });

  it('keeps local midnight correct across a daylight-saving change', () => {
    const week = getWeekRange('2026-03-08T12:00:00.000Z', 'America/New_York');
    expect(week.start).toBe('2026-03-02T05:00:00.000Z');
    expect(week.end).toBe('2026-03-09T04:00:00.000Z');
  });

  it('formats the week range in the given time zone', () => {
    expect(formatWeekRange(utcWeek, 'UTC')).toBe('29 Dec 2025 – 5 Jan 2026');
  });

  it('formats local times in the given time zone', () => {
    expect(formatLocalTime('2026-01-01T00:00:00.000Z', 'Asia/Kolkata')).toBe('05:30');
    expect(
      formatShiftWindow(
        {
          id: 'shift-1',
          assigneeId: 'member-1',
          startsAt: '2026-01-01T00:00:00.000Z',
          endsAt: '2026-01-01T01:00:00.000Z',
        },
        'Asia/Kolkata',
      ),
    ).toBe('05:30 – 06:30');
  });

  it('groups shifts by local day in the given time zone', () => {
    const shifts: WeekShift[] = [
      {
        id: 'shift-late',
        assigneeId: 'member-1',
        startsAt: '2026-03-08T13:00:00.000Z',
        endsAt: '2026-03-08T17:00:00.000Z',
      },
      {
        id: 'shift-early',
        assigneeId: 'member-2',
        startsAt: '2026-03-08T07:00:00.000Z',
        endsAt: '2026-03-08T11:00:00.000Z',
      },
      {
        id: 'shift-next-day',
        assigneeId: 'member-3',
        startsAt: '2026-03-09T13:00:00.000Z',
        endsAt: '2026-03-09T17:00:00.000Z',
      },
    ];

    const groups = groupShiftsByDay(shifts, 'America/New_York');

    expect(groups.map((group) => group.dateKey)).toEqual(['2026-03-08', '2026-03-09']);
    expect(groups[0]?.shifts.map((shift) => shift.id)).toEqual([
      'shift-early',
      'shift-late',
    ]);
    expect(localDateKey('2026-03-08T07:00:00.000Z', 'America/New_York')).toBe(
      '2026-03-08',
    );
  });

  it('builds consecutive local calendar days across a daylight-saving change', () => {
    const days = calendarDaysFrom('2026-03-07T12:00:00.000Z', 'America/New_York', 3);

    expect(days).toEqual([
      '2026-03-07T05:00:00.000Z',
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ]);
  });

  it('converts local wall time to an ISO instant in the given zone', () => {
    expect(localDateTimeToIso('2026-01-05', '09:00', 'UTC')).toBe('2026-01-05T09:00:00.000Z');
    expect(localDateTimeToIso('2026-01-05', '09:00', 'Asia/Kolkata')).toBe(
      '2026-01-05T03:30:00.000Z',
    );
    expect(() => localDateTimeToIso('2026-01-05', '9:30', 'UTC')).toThrow(
      'Invalid local date or time',
    );
  });
});
