import { describe, expect, it } from 'vitest';

import {
  combineLocalDateTime,
  formatLocalDateTime,
  isFutureShift,
  isValidShiftWindow,
  nextDayChips,
  quarterHourOptions,
} from './dateTime';

describe('date and time input helpers', () => {
  it('builds 14 local day chips across a daylight-saving change', () => {
    const chips = nextDayChips('2026-03-07T12:00:00.000Z', 'America/New_York');

    expect(chips).toHaveLength(14);
    expect(chips[0]?.dateKey).toBe('2026-03-07');
    expect(chips[13]?.dateKey).toBe('2026-03-20');
    expect(chips[0]?.label).toBe('Sat 7 Mar');
  });

  it('builds 15-minute time options without a picker package', () => {
    const options = quarterHourOptions();

    expect(options).toHaveLength(96);
    expect(options[0]).toBe('00:00');
    expect(options[1]).toBe('00:15');
    expect(options[95]).toBe('23:45');
  });

  it('turns a local date and time into an ISO string with a timezone offset', () => {
    expect(combineLocalDateTime('2026-01-05', '09:15', 'Asia/Kolkata')).toBe(
      '2026-01-05T03:45:00.000Z',
    );
    expect(combineLocalDateTime('2026-03-08', '09:00', 'America/New_York')).toBe(
      '2026-03-08T13:00:00.000Z',
    );
  });

  it('rejects a window whose end is not after its start', () => {
    expect(isValidShiftWindow('2026-01-05T09:00:00.000Z', '2026-01-05T09:00:00.000Z')).toBe(false);
    expect(isValidShiftWindow('2026-01-05T09:00:00.000Z', '2026-01-05T08:45:00.000Z')).toBe(false);
    expect(isValidShiftWindow('2026-01-05T09:00:00.000Z', '2026-01-05T09:15:00.000Z')).toBe(true);
  });

  it('recognises only future shifts against a fixed clock', () => {
    const now = '2026-01-05T12:00:00.000Z';
    expect(isFutureShift('2026-01-05T12:01:00.000Z', now)).toBe(true);
    expect(isFutureShift('2026-01-05T12:00:00.000Z', now)).toBe(false);
    expect(isFutureShift('2026-01-05T11:59:00.000Z', now)).toBe(false);
  });

  it('formats a shift time in the phone timezone', () => {
    expect(formatLocalDateTime('2026-01-05T09:00:00.000Z', 'Asia/Kolkata')).toBe(
      'Mon 5 Jan at 14:30',
    );
  });
});
