const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_TEAM_NAME_LENGTH = 80;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim()) && value.trim().length <= 254;
}

export function isValidPassword(value: string): boolean {
  return value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH;
}

export function normalizeTeamName(value: string): string {
  return value.trim();
}

export function isValidTeamName(value: string): boolean {
  const name = normalizeTeamName(value);
  return name.length >= 1 && name.length <= MAX_TEAM_NAME_LENGTH;
}
