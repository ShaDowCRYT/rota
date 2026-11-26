import { describe, expect, it } from 'vitest';

import { TEST_IDS } from '../../test/fakes';
import { createTeamIdContextValue, readTeamIdContextValue } from './teamIdContext';

const TEAM_TABS = ['index', 'members', 'activity', 'swaps'] as const;

describe('team id context value', () => {
  it('gives every team tab the same validated id', () => {
    const value = createTeamIdContextValue([TEST_IDS.team, TEST_IDS.user]);

    for (const tab of TEAM_TABS) {
      expect({ tab, teamId: readTeamIdContextValue(value) }).toEqual({
        tab,
        teamId: TEST_IDS.team,
      });
    }
  });

  it('gives every team tab no id when the route param is missing or invalid', () => {
    const rawValues = [undefined, 'undefined', [undefined, TEST_IDS.team]];

    for (const raw of rawValues) {
      const value = createTeamIdContextValue(raw);
      for (const tab of TEAM_TABS) {
        expect({ tab, teamId: readTeamIdContextValue(value) }).toEqual({
          tab,
          teamId: undefined,
        });
      }
    }
  });
});
