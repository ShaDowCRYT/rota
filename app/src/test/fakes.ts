import type { FetchResponse } from '../api/types';

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
