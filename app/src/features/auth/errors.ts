import { ApiError } from '../../api/client';
import type { FetchResponse } from '../../api/types';

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

export type ErrorContext =
  | 'default'
  | 'signup'
  | 'invite'
  | 'reset'
  | 'google'
  | 'team'
  | 'shift'
  | 'swap';

export type FriendlyError = {
  kind: FriendlyErrorKind;
  message: string;
};

export type FailureReason =
  | 'shift_overlap'
  | 'swap_already_decided'
  | 'swap_already_pending'
  | 'assignee_changed'
  | 'swap_cannot_cancel'
  | 'team_limit_reached';

const REASON_BY_SERVER_MESSAGE: Readonly<Record<string, FailureReason>> = {
  'This shift overlaps another shift for that person': 'shift_overlap',
  'This request was already decided': 'swap_already_decided',
  'A swap request is already pending': 'swap_already_pending',
  'This shift is no longer assigned to the requester': 'assignee_changed',
  'This swap request cannot be cancelled': 'swap_cannot_cancel',
  'You have reached the limit of 5 teams': 'team_limit_reached',
};

export function readFailureReason(body: unknown): FailureReason | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const message = (body as { error?: unknown }).error;
  if (typeof message !== 'string') return undefined;
  return REASON_BY_SERVER_MESSAGE[message];
}

export async function readFailureReasonFromResponse(
  response: FetchResponse,
): Promise<FailureReason | undefined> {
  try {
    return readFailureReason(await response.json());
  } catch {
    return undefined;
  }
}

export class ApiFailure extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly reason?: FailureReason;
  readonly endpoint?: string;
  readonly method?: string;

  constructor(
    status: number,
    retryAfterSeconds?: number,
    reason?: FailureReason,
    endpoint?: string,
    method?: string,
  ) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiFailure';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.reason = reason;
    this.endpoint = endpoint;
    this.method = method;
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

export function devWarn(message: string, details: Record<string, unknown>): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn(message, details);
  }
}

export function mapError(error: unknown, context: ErrorContext = 'default'): FriendlyError {
  const result = toFriendlyError(error, context);
  devWarn('Error mapped', {
    kind: result.kind,
    status: getStatus(error),
    context,
    endpoint: getEndpoint(error),
    method: getMethod(error),
  });
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
    if (error.status === 0) {
      return { kind: 'validation', message: 'Something went wrong. Try again.' };
    }
    if (error.status === 400) {
      if (context === 'invite' || context === 'reset') {
        return { kind: 'invalid-link', message: 'This link is invalid or has expired.' };
      }
      if (error.method === 'GET') {
        return { kind: 'validation', message: 'Something went wrong. Try again.' };
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
      const specific = mapFailureReason(error.reason);
      if (specific) return specific;
      if (context === 'invite') {
        return { kind: 'conflict', message: 'You are already in this team.' };
      }
      if (context === 'team' || context === 'shift' || context === 'swap') {
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

function mapFailureReason(reason: FailureReason | undefined): FriendlyError | null {
  if (!reason) return null;
  const messages: Record<FailureReason, string> = {
    shift_overlap: 'That shift overlaps another shift for that person',
    swap_already_decided: 'This request was already decided',
    swap_already_pending: 'A swap is already requested for this shift',
    assignee_changed: 'That shift is no longer assigned to the requester',
    swap_cannot_cancel: 'This swap request cannot be cancelled',
    team_limit_reached: 'You have reached the limit of 5 teams',
  };
  return { kind: 'conflict', message: messages[reason] };
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

function getEndpoint(error: unknown): string | null {
  if (error instanceof ApiFailure) return error.endpoint ?? null;
  return null;
}

function getMethod(error: unknown): string | null {
  if (error instanceof ApiFailure) return error.method ?? null;
  return null;
}
