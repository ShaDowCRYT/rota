export type TokenStorageAdapter = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export const REFRESH_TOKEN_KEY = 'rota.refreshToken';

const secureStoreAdapter: TokenStorageAdapter = {
  getItemAsync: async (key) => {
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  },
  setItemAsync: async (key, value) => {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  },
  deleteItemAsync: async (key) => {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
  },
};

export function createTokenStorage(adapter: TokenStorageAdapter = secureStoreAdapter) {
  return {
    read: () => adapter.getItemAsync(REFRESH_TOKEN_KEY),
    write: (value: string) => adapter.setItemAsync(REFRESH_TOKEN_KEY, value),
    delete: () => adapter.deleteItemAsync(REFRESH_TOKEN_KEY),
  };
}

export const tokenStorage = createTokenStorage();
