import { describe, expect, it } from 'vitest';

import { resolveTeamIdParam } from './ids';
import { TEST_IDS } from '../test/fakes';

describe('resolveTeamIdParam', () => {
  it('accepts a UUID string', () => {
    expect(resolveTeamIdParam(TEST_IDS.team)).toBe(TEST_IDS.team);
  });

  it('accepts only the first array item', () => {
    expect(resolveTeamIdParam([TEST_IDS.team, TEST_IDS.user])).toBe(TEST_IDS.team);
    expect(resolveTeamIdParam([TEST_IDS.user, TEST_IDS.team])).toBe(TEST_IDS.user);
    expect(resolveTeamIdParam(['undefined', TEST_IDS.team])).toBeUndefined();
  });

  it('rejects undefined', () => {
    expect(resolveTeamIdParam(undefined)).toBeUndefined();
  });

  it('rejects an invalid string', () => {
    expect(resolveTeamIdParam('undefined')).toBeUndefined();
    expect(resolveTeamIdParam('team-1')).toBeUndefined();
    expect(resolveTeamIdParam('')).toBeUndefined();
  });

  it('rejects an empty array and an array without a string', () => {
    expect(resolveTeamIdParam([])).toBeUndefined();
    expect(resolveTeamIdParam([undefined, 1])).toBeUndefined();
  });
});
