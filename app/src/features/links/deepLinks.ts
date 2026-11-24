export type DeepLinkKind = 'invite' | 'reset';

const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 200;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export type DeepLinkParam = string | string[] | null | undefined;

export function normalizeDeepLinkToken(value: DeepLinkParam): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  if (!TOKEN_PATTERN.test(token)) return null;
  return token;
}
