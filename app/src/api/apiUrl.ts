export const API_PORT = 3000;

export type ApiUrlInputs = {
  configuredUrl: string | undefined;
  isDev: boolean;
  hostUri: string | undefined;
};

export class ApiUrlError extends Error {
  constructor() {
    super("Can't reach the server. No API URL is configured.");
    this.name = 'ApiUrlError';
  }
}

export function resolveApiUrl({ configuredUrl, isDev, hostUri }: ApiUrlInputs): string {
  const configured = configuredUrl?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  if (isDev) {
    const host = hostFromMetroUri(hostUri);
    if (host) {
      return `http://${host}:${API_PORT}`;
    }
  }

  throw new ApiUrlError();
}

function hostFromMetroUri(hostUri: string | undefined): string | undefined {
  if (!hostUri) return undefined;

  const withoutScheme = hostUri.replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
  const authority = withoutScheme.split('/')[0] ?? '';

  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    return close === -1 ? undefined : authority.slice(0, close + 1);
  }

  return authority.split(':')[0] || undefined;
}
