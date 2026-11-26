import { describe, expect, it } from 'vitest';

import { ApiError } from '../../api/client';
import {
  ApiFailure,
  GoogleSignInFailure,
  mapError,
  readFailureReason,
  SessionEndedError,
} from './errors';

describe('mapError', () => {
  it('maps network failures', () => {
    expect(mapError(new TypeError('Failed to fetch')).kind).toBe('network');
  });

  it('maps timeouts', () => {
    expect(mapError(new ApiError('timeout', 'Request timed out.')).kind).toBe('timeout');
  });

  it('maps validation errors', () => {
    expect(mapError(new ApiFailure(400)).kind).toBe('validation');
  });

  it('maps a GET 400 to the generic read message', () => {
    const result = mapError(
      new ApiFailure(400, undefined, undefined, 'GET /teams/:teamId/members', 'GET'),
      'team',
    );
    expect(result.message).toBe('Something went wrong. Try again.');
    expect(result.message).not.toContain('details');
  });

  it('keeps the details message for form 400s', () => {
    const result = mapError(
      new ApiFailure(400, undefined, undefined, 'POST /auth/signup', 'POST'),
      'signup',
    );
    expect(result.message).toBe('Check your details and try again.');
  });

  it('maps a local invalid-id failure without leaking an id', () => {
    const failure = new ApiFailure(0, undefined, undefined, 'GET /teams/:teamId', 'GET');
    expect(failure.endpoint).toBe('GET /teams/:teamId');
    expect(failure.status).toBe(0);
    expect(mapError(failure, 'team').message).toBe('Something went wrong. Try again.');
  });

  it('maps invalid credentials', () => {
    expect(mapError(new ApiFailure(401)).kind).toBe('invalid-credentials');
  });

  it('maps duplicate email', () => {
    const result = mapError(new ApiFailure(409));
    expect(result.kind).toBe('email-taken');
    expect(result.message).toBe('Email already in use');
  });

  it('maps rate limits using Retry-After minutes', () => {
    const result = mapError(new ApiFailure(429, 120));
    expect(result.kind).toBe('rate-limited');
    expect(result.message).toBe('Too many attempts. Try again in 2 minutes');
  });

  it('maps 503 to service-unavailable', () => {
    const result = mapError(new ApiFailure(503));
    expect(result.kind).toBe('service-unavailable');
    expect(result.message).toBe('Service unavailable. Try again.');
  });

  it.each([500, 502, 504])('maps %i to unknown when the server answered', (status) => {
    const result = mapError(new ApiFailure(status));
    expect(result.kind).toBe('unknown');
    expect(result.kind).not.toBe('network');
    expect(result.kind).not.toBe('timeout');
    expect(result.message).toBe('Something went wrong. Try again.');
    expect(result.message).not.toContain('Can\'t reach the server');
    expect(result.message).not.toContain('Request failed with status');
  });

  it('uses network and timeout only when no response arrived', () => {
    expect(mapError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(mapError(new ApiError('unreachable', 'Server unreachable.')).kind).toBe('network');
    expect(mapError(new ApiError('timeout', 'Request timed out.')).kind).toBe('timeout');
    expect(mapError(new ApiError('service_unavailable', 'Service unavailable.')).kind).toBe('service-unavailable');
  });

  it('maps unknown failures without leaking raw text', () => {
    const raw = 'RAW-SERVER-DETAIL-MUST-NOT-SHOW';
    const result = mapError(new Error(raw));
    expect(result.kind).toBe('unknown');
    expect(result.message).not.toContain(raw);
  });

  it('maps an ended session without leaking raw text', () => {
    const result = mapError(new SessionEndedError());
    expect(result.kind).toBe('unknown');
    expect(result.message).toBe('Your session has ended. Please log in again.');
  });

  it('maps 403 and 404 to friendly messages without raw text', () => {
    const forbidden = mapError(new ApiFailure(403));
    expect(forbidden.kind).toBe('forbidden');
    expect(forbidden.message).toBe("You don't have permission to do that");
    expect(forbidden.message).not.toContain('403');

    const missing = mapError(new ApiFailure(404));
    expect(missing.kind).toBe('not-found');
    expect(missing.message).toBe('Not found');
  });

  it('maps invite and reset failures to expired-link messages', () => {
    expect(mapError(new ApiFailure(400), 'invite').message).toBe('This link is invalid or has expired.');
    expect(mapError(new ApiFailure(403), 'invite').message).toBe('This link is invalid or has expired.');
    expect(mapError(new ApiFailure(400), 'reset').message).toBe('This link is invalid or has expired.');
  });

  it('maps invite conflict to a team message', () => {
    const result = mapError(new ApiFailure(409), 'invite');
    expect(result.kind).toBe('conflict');
    expect(result.message).toBe('You are already in this team.');
  });

  it('maps the team creation limit conflict to a friendly message', () => {
    const result = mapError(new ApiFailure(409, undefined, 'team_limit_reached'), 'team');
    expect(result.kind).toBe('conflict');
    expect(result.message).toBe('You have reached the limit of 5 teams');
  });

  it('maps Google server and library failures without raw text', () => {
    const invalid = mapError(new ApiFailure(401), 'google');
    expect(invalid.kind).toBe('google');
    expect(invalid.message).toBe('Google sign-in failed. Try again.');

    const unavailable = mapError(new ApiFailure(503), 'google');
    expect(unavailable.kind).toBe('service-unavailable');
    expect(unavailable.message).toBe('Google sign-in is not available. Try again.');

    const raw = 'RAW-NATIVE-GOOGLE-MESSAGE-MUST-NOT-SHOW';
    const library = mapError(new GoogleSignInFailure('DEVELOPER_ERROR'));
    expect(library.kind).toBe('google');
    expect(library.message).toContain('not set up correctly');
    expect(library.message).not.toContain(raw);
    expect(library.message).not.toContain('DEVELOPER_ERROR');
  });

  it('maps shift and swap conflicts to friendly messages without raw text', () => {
    const raw = 'RAW-CONFLICT-DETAIL-MUST-NOT-SHOW';
    const overlap = mapError(new ApiFailure(409, undefined, 'shift_overlap'), 'shift');
    expect(overlap.message).toBe('That shift overlaps another shift for that person');
    expect(overlap.message).not.toContain(raw);
    expect(overlap.message).not.toContain('409');

    const decided = mapError(new ApiFailure(409, undefined, 'swap_already_decided'), 'swap');
    expect(decided.message).toBe('This request was already decided');

    const duplicate = mapError(new ApiFailure(409, undefined, 'swap_already_pending'), 'swap');
    expect(duplicate.message).toBe('A swap is already requested for this shift');
  });

  it('maps 403 and 404 in shift and swap contexts without raw text', () => {
    const raw = 'RAW-PERMISSION-DETAIL-MUST-NOT-SHOW';
    const forbidden = mapError(new ApiFailure(403), 'shift');
    expect(forbidden.kind).toBe('forbidden');
    expect(forbidden.message).not.toContain(raw);
    expect(forbidden.message).not.toContain('403');

    const missing = mapError(new ApiFailure(404), 'swap');
    expect(missing.kind).toBe('not-found');
    expect(missing.message).not.toContain(raw);
    expect(missing.message).not.toContain('404');
  });

  it('reads only recognised server conflict reasons', () => {
    expect(readFailureReason({ error: 'This shift overlaps another shift for that person' })).toBe(
      'shift_overlap',
    );
    expect(readFailureReason({ error: 'RAW-CONFLICT-DETAIL-MUST-NOT-SHOW' })).toBeUndefined();
    expect(readFailureReason({ error: 409 })).toBeUndefined();
  });
});
