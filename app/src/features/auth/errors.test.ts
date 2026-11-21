import { describe, expect, it } from 'vitest';

import { ApiError } from '../../api/client';
import { ApiFailure, mapError, SessionEndedError } from './errors';

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

  it('maps invalid credentials', () => {
    expect(mapError(new ApiFailure(401)).kind).toBe('invalid-credentials');
  });

  it('maps duplicate email', () => {
    expect(mapError(new ApiFailure(409)).kind).toBe('email-taken');
  });

  it('maps rate limits using Retry-After minutes', () => {
    const result = mapError(new ApiFailure(429, 120));
    expect(result.kind).toBe('rate-limited');
    expect(result.message).toBe('Too many attempts. Try again in 2 minutes');
  });

  it('maps service failures', () => {
    expect(mapError(new ApiFailure(503)).kind).toBe('service-unavailable');
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
});
