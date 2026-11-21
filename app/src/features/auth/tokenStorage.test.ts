import { describe, expect, it, vi } from 'vitest';

import { createTokenStorage, REFRESH_TOKEN_KEY } from './tokenStorage';

describe('createTokenStorage', () => {
  it('reads, writes, and deletes under one secure key', async () => {
    const adapter = {
      getItemAsync: vi.fn(async () => 'stored-value'),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    };
    const storage = createTokenStorage(adapter);

    await expect(storage.read()).resolves.toBe('stored-value');
    await storage.write('next-value');
    await storage.delete();

    expect(adapter.getItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    expect(adapter.setItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY, 'next-value');
    expect(adapter.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
  });
});
