import { create } from 'zustand';

import type { DeepLinkKind } from './deepLinks';

type PendingLink = {
  kind: DeepLinkKind;
  token: string;
};

type PendingLinkState = {
  pending: PendingLink | null;
  setPending: (kind: DeepLinkKind, token: string) => void;
  clearPending: () => void;
};

export const usePendingLinkStore = create<PendingLinkState>((set) => ({
  pending: null,
  setPending: (kind, token) => set({ pending: { kind, token } }),
  clearPending: () => set({ pending: null }),
}));

export function setPendingLink(kind: DeepLinkKind, token: string): void {
  usePendingLinkStore.getState().setPending(kind, token);
}

export function readPendingLink(kind: DeepLinkKind): string | null {
  const pending = usePendingLinkStore.getState().pending;
  if (!pending || pending.kind !== kind) return null;
  return pending.token;
}

export function clearPendingLink(): void {
  usePendingLinkStore.getState().clearPending();
}
