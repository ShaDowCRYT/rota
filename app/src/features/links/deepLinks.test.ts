import { describe, expect, it } from 'vitest';

import { normalizeDeepLinkToken } from './deepLinks';

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
