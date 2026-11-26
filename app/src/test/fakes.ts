import type { FetchResponse } from '../api/types';

export const TEST_IDS = {
  team: '11111111-1111-4111-8111-111111111111',
  user: '22222222-2222-4222-8222-222222222222',
  member: '33333333-3333-4333-8333-333333333333',
  invite: '44444444-4444-4444-8444-444444444444',
  shift: '55555555-5555-4555-8555-555555555555',
  swap: '66666666-6666-4666-8666-666666666666',
} as const;

type FakeResponseOptions = {
  status?: number;
  body?: unknown;
  retryAfter?: string;
};

export function fakeResponse({
  status = 200,
  body = null,
  retryAfter,
}: FakeResponseOptions = {}): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
