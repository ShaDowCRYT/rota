export type HealthStatus = 'ok' | 'error';

export type HealthReadyResponse = {
  status: HealthStatus;
  database: HealthStatus;
  redis: HealthStatus;
};

export type ApiErrorKind = 'unreachable' | 'timeout' | 'service_unavailable' | 'unknown';

export class ApiError extends Error {
  kind: ApiErrorKind;
  details?: HealthReadyResponse;

  constructor(kind: ApiErrorKind, message: string, details?: HealthReadyResponse) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.details = details;
  }
}

const REQUEST_TIMEOUT_MS = 10000;

function getApiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new ApiError('unknown', 'Missing API URL.');
  }
  return url.replace(/\/$/, '');
}

export async function getHealthReady(): Promise<HealthReadyResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${getApiUrl()}/health/ready`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (isHealthReadyResponse(data)) {
      if (!response.ok || data.status !== 'ok') {
        throw new ApiError('service_unavailable', 'Service unavailable.', data);
      }
      return data;
    }

    throw new ApiError('unknown', 'Invalid server response.');
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('timeout', 'Request timed out.');
    }
    throw new ApiError('unreachable', 'Server unreachable.');
  } finally {
    clearTimeout(timeoutId);
  }
}

function isHealthReadyResponse(value: unknown): value is HealthReadyResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return isHealthStatus(v.status) && isHealthStatus(v.database) && isHealthStatus(v.redis);
}

function isHealthStatus(value: unknown): value is HealthStatus {
  return value === 'ok' || value === 'error';
}
