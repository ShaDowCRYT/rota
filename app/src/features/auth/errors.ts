import { ApiError } from '../../api/client';

export type FriendlyErrorKind =
  | 'network'
  | 'timeout'
  | 'validation'
  | 'invalid-credentials'
  | 'email-taken'
  | 'rate-limited'
  | 'service-unavailable'
  | 'unknown';

export type FriendlyError = {
  kind: FriendlyErrorKind;
  message: string;
};

export class ApiFailure extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(status: number, retryAfterSeconds?: number) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiFailure';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class SessionEndedError extends Error {
  constructor() {
    super('Session ended');
    this.name = 'SessionEndedError';
  }
}

export function mapError(error: unknown): FriendlyError {
  const result = toFriendlyError(error);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('Auth error mapped', { kind: result.kind, status: getStatus(error) });
  }
  return result;
}

function toFriendlyError(error: unknown): FriendlyError {
  if (error instanceof SessionEndedError) {
    return { kind: 'unknown', message: 'Your session has ended. Please log in again.' };
  }

  if (error instanceof ApiFailure) {
    if (error.status === 400) {
      return { kind: 'validation', message: 'Check your details and try again.' };
    }
    if (error.status === 401) {
      return { kind: 'invalid-credentials', message: 'Invalid email or password.' };
    }
    if (error.status === 409) {
      return { kind: 'email-taken', message: 'Email already in use' };
    }
    if (error.status === 429) {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
      return { kind: 'rate-limited', message: `Too many attempts. Try again in ${minutes} minutes` };
    }
    if (error.status === 503) {
      return { kind: 'service-unavailable', message: 'Service unavailable. Try again.' };
    }
    if (error.status >= 500) {
      return { kind: 'unknown', message: 'Something went wrong. Try again.' };
    }
    return { kind: 'unknown', message: 'Something went wrong. Try again.' };
  }

  if (error instanceof ApiError) {
    if (error.kind === 'timeout') {
      return { kind: 'timeout', message: 'The server took too long. Try again.' };
    }
    if (error.kind === 'unreachable') {
      return { kind: 'network', message: "Can't reach the server. Check your connection and try again." };
    }
    if (error.kind === 'service_unavailable') {
      return { kind: 'service-unavailable', message: 'Service unavailable. Try again.' };
    }
    return { kind: 'unknown', message: 'Something went wrong. Try again.' };
  }

  if (error instanceof TypeError) {
    return { kind: 'network', message: "Can't reach the server. Check your connection and try again." };
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return { kind: 'timeout', message: 'The server took too long. Try again.' };
  }

  return { kind: 'unknown', message: 'Something went wrong. Try again.' };
}

function getStatus(error: unknown): number | null {
  if (error instanceof ApiFailure) return error.status;
  return null;
}
