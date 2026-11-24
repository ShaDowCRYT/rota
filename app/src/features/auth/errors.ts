import { ApiError } from '../../api/client';

export type FriendlyErrorKind =
  | 'network'
  | 'timeout'
  | 'validation'
  | 'invalid-credentials'
  | 'email-taken'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'invalid-link'
  | 'rate-limited'
  | 'service-unavailable'
  | 'google'
  | 'unknown';

export type ErrorContext = 'default' | 'signup' | 'invite' | 'reset' | 'google' | 'team';

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

export class GoogleSignInFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super('Google sign-in failed');
    this.name = 'GoogleSignInFailure';
    this.code = code;
  }
}

export function mapError(error: unknown, context: ErrorContext = 'default'): FriendlyError {
  const result = toFriendlyError(error, context);
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('Error mapped', { kind: result.kind, status: getStatus(error), context });
  }
  return result;
}

function toFriendlyError(error: unknown, context: ErrorContext): FriendlyError {
  if (error instanceof SessionEndedError) {
    return { kind: 'unknown', message: 'Your session has ended. Please log in again.' };
  }

  if (error instanceof GoogleSignInFailure) {
    return mapGoogleFailure(error.code);
  }

  if (error instanceof ApiFailure) {
    if (error.status === 400) {
      if (context === 'invite' || context === 'reset') {
        return { kind: 'invalid-link', message: 'This link is invalid or has expired.' };
      }
      return { kind: 'validation', message: 'Check your details and try again.' };
    }
    if (error.status === 401) {
      if (context === 'google') {
        return { kind: 'google', message: 'Google sign-in failed. Try again.' };
      }
      if (context === 'invite') {
        return { kind: 'invalid-link', message: 'This link is invalid or has expired.' };
      }
      return { kind: 'invalid-credentials', message: 'Invalid email or password.' };
    }
    if (error.status === 403) {
      if (context === 'invite') {
        return { kind: 'invalid-link', message: 'This link is invalid or has expired.' };
      }
      return { kind: 'forbidden', message: "You don't have permission to do that" };
    }
    if (error.status === 404) {
      return { kind: 'not-found', message: 'Not found' };
    }
    if (error.status === 409) {
      if (context === 'invite') {
        return { kind: 'conflict', message: 'You are already in this team.' };
      }
      if (context === 'team') {
        return { kind: 'conflict', message: 'That change is no longer available. Check and try again.' };
      }
      return { kind: 'email-taken', message: 'Email already in use' };
    }
    if (error.status === 429) {
      const minutes = Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60));
      return { kind: 'rate-limited', message: `Too many attempts. Try again in ${minutes} minutes` };
    }
    if (error.status === 503) {
      if (context === 'google') {
        return { kind: 'service-unavailable', message: 'Google sign-in is not available. Try again.' };
      }
      return { kind: 'service-unavailable', message: 'Service unavailable. Try again.' };
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

function mapGoogleFailure(code: string): FriendlyError {
  if (code === 'PLAY_SERVICES_NOT_AVAILABLE') {
    return { kind: 'google', message: 'Google Play services are not available on this device.' };
  }
  if (code === 'DEVELOPER_ERROR') {
    return { kind: 'google', message: 'Google sign-in is not set up correctly. Ask the developer to check it.' };
  }
  if (code === 'IN_PROGRESS') {
    return { kind: 'google', message: 'Google sign-in is already starting. Try again.' };
  }
  return { kind: 'google', message: 'Google sign-in failed. Try again.' };
}

function getStatus(error: unknown): number | null {
  if (error instanceof ApiFailure) return error.status;
  return null;
}
