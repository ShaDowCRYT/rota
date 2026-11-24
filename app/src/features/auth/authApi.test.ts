import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../../api/types';
import { fakeResponse } from '../../test/fakes';
import * as authApi from './authApi';
import { ApiFailure } from './errors';

function makeFetcher(status: number, body: unknown): { fetcher: FetchLike; calls: { path: string; init?: RequestInit }[] } {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetcher: FetchLike = async (path, init) => {
    calls.push({ path, init });
    return fakeResponse({ status, body });
  };
  return { fetcher, calls };
}

const tokens = {
  user: { id: 'user-1', email: 'person@example.com' },
  accessToken: 'access-token-value',
  refreshToken: 'refresh-token-value',
};

describe('authApi password reset and Google endpoints', () => {
  it('posts the Google ID token to /auth/google', async () => {
    const { fetcher, calls } = makeFetcher(200, tokens);

    const result = await authApi.googleSignIn('id-token-value', fetcher);

    expect(result).toEqual(tokens);
    expect(calls[0].path).toBe('/auth/google');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ idToken: 'id-token-value' });
  });

  it('posts forgot password with the email', async () => {
    const { fetcher, calls } = makeFetcher(202, {
      message: 'If that email exists, a reset link has been sent.',
    });

    await expect(authApi.forgotPassword('person@example.com', fetcher)).resolves.toBeUndefined();
    expect(calls[0].path).toBe('/auth/forgot');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ email: 'person@example.com' });
  });

  it('posts reset with the token and new password and accepts 204', async () => {
    const { fetcher, calls } = makeFetcher(204, null);

    await expect(
      authApi.resetPassword('reset-token-value-abcdefghijklmnop', 'new-password-value', fetcher),
    ).resolves.toBeUndefined();
    expect(calls[0].path).toBe('/auth/reset');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      token: 'reset-token-value-abcdefghijklmnop',
      newPassword: 'new-password-value',
    });
  });

  it('maps reset failures to ApiFailure', async () => {
    const { fetcher } = makeFetcher(400, { error: 'Invalid or expired token' });
    await expect(
      authApi.resetPassword('reset-token-value-abcdefghijklmnop', 'new-password-value', fetcher),
    ).rejects.toBeInstanceOf(ApiFailure);
  });
});
