export type DeepLinkKind = 'invite' | 'reset';

const MIN_TOKEN_LENGTH = 20;
const MAX_TOKEN_LENGTH = 200;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const INVITE_LINK_SCHEME = 'rota:';
const INVITE_LINK_PATH = 'invite';

export type DeepLinkParam = string | string[] | null | undefined;

export const INVALID_INVITE_LINK_MESSAGE =
  "That doesn't look like an invite link. Paste the whole link you were sent.";

export function normalizeDeepLinkToken(value: DeepLinkParam): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  if (!TOKEN_PATTERN.test(token)) return null;
  return token;
}

export function parseInviteInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const bareToken = normalizeDeepLinkToken(trimmed);
  if (bareToken) return bareToken;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== INVITE_LINK_SCHEME) return null;

  const path = `${url.hostname}${url.pathname}`.replace(/^\/+|\/+$/g, '');
  if (path !== INVITE_LINK_PATH) return null;

  return normalizeDeepLinkToken(url.searchParams.get('token'));
}
