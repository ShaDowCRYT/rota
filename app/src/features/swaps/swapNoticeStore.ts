import { create } from 'zustand';

type SwapNoticeState = {
  message: string | null;
  setMessage: (message: string) => void;
  clearMessage: () => void;
};

export const useSwapNoticeStore = create<SwapNoticeState>((set) => ({
  message: null,
  setMessage: (message) => set({ message }),
  clearMessage: () => set({ message: null }),
}));
