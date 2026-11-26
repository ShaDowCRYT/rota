import { describe, expect, it } from 'vitest';

import { normalizeDeepLinkToken, parseInviteInput } from './deepLinks';

describe('normalizeDeepLinkToken', () => {
  it('accepts a valid opaque token', () => {
    const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-';
    expect(normalizeDeepLinkToken(token)).toBe(token);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeDeepLinkToken('  abcdefghijklmnopqrstuvwxyz012345  ')).toBe(
      'abcdefghijklmnopqrstuvwxyz012345',
    );
  });

  it('uses the first value when the param is an array', () => {
    expect(normalizeDeepLinkToken(['abcdefghijklmnopqrstuvwxyz012345', 'other'])).toBe(
      'abcdefghijklmnopqrstuvwxyz012345',
    );
  });

  it.each([null, undefined, '', 'short', 'a'.repeat(201), 'has spaces', 'has/slash'])(
    'rejects %s',
    (value) => {
      expect(normalizeDeepLinkToken(value)).toBeNull();
    },
  );
});

describe('parseInviteInput', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-';

  it('parses a full invite link', () => {
    expect(parseInviteInput(`rota://invite?token=${token}`)).toBe(token);
  });

  it('parses an invite link with surrounding whitespace and newlines', () => {
    expect(parseInviteInput(` \n rota://invite?token=${token} \n `)).toBe(token);
  });

  it('parses a bare token', () => {
    expect(parseInviteInput(token)).toBe(token);
  });

  it('parses an invite link with extra parameters', () => {
    expect(parseInviteInput(`rota://invite?source=share&token=${token}&other=1`)).toBe(token);
  });

  it('rejects an empty string', () => {
    expect(parseInviteInput('')).toBeNull();
  });

  it('rejects a wrong scheme', () => {
    expect(parseInviteInput(`https://example.com/invite?token=${token}`)).toBeNull();
  });

  it('rejects a too-short token', () => {
    expect(parseInviteInput('rota://invite?token=short')).toBeNull();
    expect(parseInviteInput('short')).toBeNull();
  });

  it('rejects a link for another path', () => {
    expect(parseInviteInput(`rota://reset?token=${token}`)).toBeNull();
  });
});
