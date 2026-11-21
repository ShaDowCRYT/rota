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
});
