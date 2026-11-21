import { create } from 'zustand';

import type { FriendlyError } from './errors';

export type SessionUser = {
  id: string;
  email: string;
};

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export type SessionState = {
  user: SessionUser | null;
  accessToken: string | null;
  status: SessionStatus;
  startupError: FriendlyError | null;
  setLoading: () => void;
  setSignedOut: () => void;
  setSignedIn: (user: SessionUser, accessToken: string) => void;
  setAccessToken: (accessToken: string) => void;
  setStartupError: (error: FriendlyError | null) => void;
  clearMemory: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  accessToken: null,
  status: 'loading',
  startupError: null,
  setLoading: () => set({ status: 'loading', startupError: null }),
  setSignedOut: () => set({ user: null, accessToken: null, status: 'signedOut', startupError: null }),
  setSignedIn: (user, accessToken) => set({ user, accessToken, status: 'signedIn', startupError: null }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setStartupError: (startupError) => set({ startupError }),
  clearMemory: () => set({ user: null, accessToken: null, startupError: null }),
}));
