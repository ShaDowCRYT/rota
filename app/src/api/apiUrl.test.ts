import { describe, expect, it } from 'vitest';

import { API_PORT, ApiUrlError, resolveApiUrl, type ApiUrlInputs } from './apiUrl';

function inputs(overrides: Partial<ApiUrlInputs> = {}): ApiUrlInputs {
  return {
    configuredUrl: undefined,
    isDev: true,
    hostUri: undefined,
    ...overrides,
  };
}

describe('resolveApiUrl', () => {
  it('uses a configured URL even when a Metro host is available', () => {
    expect(
      resolveApiUrl(
        inputs({ configuredUrl: 'https://api.example.com/', hostUri: '192.168.1.5:8081' }),
      ),
    ).toBe('https://api.example.com');
  });

  it('treats an empty or whitespace-only configured URL as unset', () => {
    expect(() => resolveApiUrl(inputs({ configuredUrl: '   ' }))).toThrow(ApiUrlError);
  });

  it('builds the API URL from a plain Metro host in development', () => {
    expect(resolveApiUrl(inputs({ hostUri: '192.168.1.5:8081' }))).toBe(
      `http://192.168.1.5:${API_PORT}`,
    );
  });

  it('strips the scheme from an exp:// style Metro host', () => {
    expect(resolveApiUrl(inputs({ hostUri: 'exp://192.168.1.5:8081' }))).toBe(
      `http://192.168.1.5:${API_PORT}`,
    );
  });

  it('strips the scheme and port from a tunnel host', () => {
    expect(resolveApiUrl(inputs({ hostUri: 'exp://abc-123.app.expo.dev:8081' }))).toBe(
      `http://abc-123.app.expo.dev:${API_PORT}`,
    );
  });

  it('throws a clear error when development has no host and no configured URL', () => {
    expect(() => resolveApiUrl(inputs())).toThrow(
      "Can't reach the server. No API URL is configured.",
    );
  });

  it('never uses the Metro host in production', () => {
    expect(() => resolveApiUrl(inputs({ isDev: false, hostUri: '192.168.1.5:8081' }))).toThrow(
      ApiUrlError,
    );
  });

  it('still uses a configured URL in production', () => {
    expect(resolveApiUrl(inputs({ isDev: false, configuredUrl: 'https://api.example.com' }))).toBe(
      'https://api.example.com',
    );
  });
});
