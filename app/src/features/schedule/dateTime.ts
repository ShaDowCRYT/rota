import {
  calendarDaysFrom,
  formatDayLabel,
  formatLocalTime,
  localDateKey,
  localDateTimeToIso,
} from './week';

export type DayChip = {
  dateKey: string;
  iso: string;
  label: string;
};

export const DAY_CHIP_COUNT = 14;
export const TIME_STEP_MINUTES = 15;

export function nextDayChips(
  nowIso: string,
  timeZone: string,
  count: number = DAY_CHIP_COUNT,
): DayChip[] {
  return calendarDaysFrom(nowIso, timeZone, count).map((iso) => ({
    dateKey: localDateKey(iso, timeZone),
    iso,
    label: formatDayLabel(iso, timeZone),
  }));
}

export function quarterHourOptions(): string[] {
  const totalMinutes = 24 * 60;
  const options: string[] = [];
  for (let minutes = 0; minutes < totalMinutes; minutes += TIME_STEP_MINUTES) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    options.push(`${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`);
  }
  return options;
}

export function combineLocalDateTime(
  dateKey: string,
  time: string,
  timeZone: string,
): string {
  return localDateTimeToIso(dateKey, time, timeZone);
}

export function dayChipFor(dateKey: string, timeZone: string): DayChip {
  const iso = combineLocalDateTime(dateKey, '00:00', timeZone);
  return { dateKey, iso, label: formatDayLabel(iso, timeZone) };
}

export function isValidShiftWindow(startIso: string, endIso: string): boolean {
  return Date.parse(endIso) > Date.parse(startIso);
}

export function isFutureShift(startsAt: string, nowIso: string): boolean {
  return Date.parse(startsAt) > Date.parse(nowIso);
}

export function formatLocalDateTime(iso: string, timeZone: string): string {
  return `${formatDayLabel(iso, timeZone)} at ${formatLocalTime(iso, timeZone)}`;
}
