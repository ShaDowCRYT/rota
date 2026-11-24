import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearPendingLink,
  readPendingLink,
  setPendingLink,
  usePendingLinkStore,
} from './pendingLinkStore';

describe('pending deep-link store', () => {
  beforeEach(() => {
    clearPendingLink();
  });

  it('sets, reads, and clears an invite token in memory', () => {
    setPendingLink('invite', 'invite-token-value-abcdefghijklmnop');
    expect(readPendingLink('invite')).toBe('invite-token-value-abcdefghijklmnop');

    clearPendingLink();
    expect(readPendingLink('invite')).toBeNull();
  });

  it('keeps invite and reset tokens separate', () => {
    setPendingLink('invite', 'invite-token-value-abcdefghijklmnop');
    expect(readPendingLink('reset')).toBeNull();

    setPendingLink('reset', 'reset-token-value-abcdefghijklmnopq');
    expect(readPendingLink('invite')).toBeNull();
    expect(readPendingLink('reset')).toBe('reset-token-value-abcdefghijklmnopq');
  });

  it('does not add persistence keys to app storage', () => {
    setPendingLink('invite', 'invite-token-value-abcdefghijklmnop');
    expect(Object.keys(usePendingLinkStore.getState())).toEqual([
      'pending',
      'setPending',
      'clearPending',
    ]);
  });
});
