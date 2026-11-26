export type WeekShift = {
  id: string;
  assigneeId: string;
  startsAt: string;
  endsAt: string;
};

export type WeekRange = {
  start: string;
  end: string;
  days: string[];
};

export type ShiftDayGroup = {
  dateKey: string;
  label: string;
  shifts: WeekShift[];
};

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const MINUTE_MS = 60_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function partsInZone(date: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: string): number => {
    const part = parts.find((item) => item.type === type);
    if (!part) throw new Error('Invalid date parts');
    return Number(part.value);
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function partsToUtcMs(parts: CalendarParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const wallMs = partsToUtcMs(partsInZone(date, timeZone));
  return Math.round((wallMs - date.getTime()) / MINUTE_MS) * MINUTE_MS;
}

function midnightForCalendarDate(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const wallUtcMs = Date.UTC(year, month - 1, day);
  let utcMs = wallUtcMs - timezoneOffsetMs(new Date(wallUtcMs), timeZone);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actualWallMs = partsToUtcMs(partsInZone(new Date(utcMs), timeZone));
    const difference = wallUtcMs - actualWallMs;
    if (difference === 0) break;
    utcMs += difference;
  }

  return new Date(utcMs);
}

function zonedMidnight(date: Date, timeZone: string): Date {
  const parts = partsInZone(date, timeZone);
  return midnightForCalendarDate(parts.year, parts.month, parts.day, timeZone);
}

function weekdayIndex(date: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(date);
  const index = WEEKDAYS.findIndex((weekday) => weekday === label);
  if (index < 0) throw new Error('Invalid weekday');
  return index;
}

function addCalendarDays(date: Date, timeZone: string, days: number): Date {
  const parts = partsInZone(date, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return midnightForCalendarDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    timeZone,
  );
}

export function calendarDaysFrom(
  anchorIso: string,
  timeZone: string,
  count: number,
): string[] {
  const midnight = zonedMidnight(new Date(anchorIso), timeZone);
  return Array.from({ length: count }, (_, index) =>
    addCalendarDays(midnight, timeZone, index).toISOString(),
  );
}

export function localDateTimeToIso(dateKey: string, time: string, timeZone: string): string {
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeParts = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateParts || !timeParts) throw new Error('Invalid local date or time');

  const wallMs = Date.UTC(
    Number(dateParts[1]),
    Number(dateParts[2]) - 1,
    Number(dateParts[3]),
    Number(timeParts[1]),
    Number(timeParts[2]),
  );

  let utcMs = wallMs;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    utcMs = wallMs - timezoneOffsetMs(new Date(utcMs), timeZone);
  }
  return new Date(utcMs).toISOString();
}

function buildRange(start: Date, timeZone: string): WeekRange {
  return {
    start: start.toISOString(),
    end: addCalendarDays(start, timeZone, 7).toISOString(),
    days: Array.from({ length: 7 }, (_, index) =>
      addCalendarDays(start, timeZone, index).toISOString(),
    ),
  };
}

export function getWeekRange(anchorIso: string, timeZone: string): WeekRange {
  const anchorMidnight = zonedMidnight(new Date(anchorIso), timeZone);
  const start = addCalendarDays(anchorMidnight, timeZone, -weekdayIndex(anchorMidnight, timeZone));
  return buildRange(start, timeZone);
}

export function shiftWeek(range: WeekRange, timeZone: string, weeks: number): WeekRange {
  const start = addCalendarDays(new Date(range.start), timeZone, weeks * 7);
  return buildRange(start, timeZone);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function localDateKey(iso: string, timeZone: string): string {
  const parts = partsInZone(new Date(iso), timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function formatWeekRange(range: WeekRange, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${formatter.format(new Date(range.start))} – ${formatter.format(new Date(range.end))}`;
}

export function formatDayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

export function formatLocalTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function formatShiftWindow(shift: WeekShift, timeZone: string): string {
  return `${formatLocalTime(shift.startsAt, timeZone)} – ${formatLocalTime(shift.endsAt, timeZone)}`;
}

export function groupShiftsByDay(
  shifts: readonly WeekShift[],
  timeZone: string,
): ShiftDayGroup[] {
  const groups = new Map<string, ShiftDayGroup>();
  const ordered = [...shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  for (const shift of ordered) {
    const dateKey = localDateKey(shift.startsAt, timeZone);
    const existing = groups.get(dateKey);
    if (existing) {
      existing.shifts.push(shift);
      continue;
    }
    groups.set(dateKey, {
      dateKey,
      label: formatDayLabel(shift.startsAt, timeZone),
      shifts: [shift],
    });
  }

  return [...groups.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}
