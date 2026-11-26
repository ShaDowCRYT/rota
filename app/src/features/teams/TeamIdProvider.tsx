import React from 'react';

import { TeamIdContext, type TeamIdContextValue } from './teamIdContext';

type Props = {
  children: React.ReactNode;
  value: TeamIdContextValue;
};

export function TeamIdProvider({ children, value }: Props) {
  return <TeamIdContext.Provider value={value}>{children}</TeamIdContext.Provider>;
}
