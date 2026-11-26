import { isValidEmail, normalizeEmail } from '../auth/validation';

export function inviteEmailIsValid(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || isValidEmail(trimmed);
}

export function inviteEmail(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : normalizeEmail(trimmed);
}

export function shareInviteLink(link: string): { message: string } {
  return {
    message: `Join my team on Rota. Open the app, tap 'Join a team with an invite link', and paste this link: ${link}`,
  };
}
