import React, { useMemo } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { useTheme } from '../../theme/useTheme';
import { dayChipFor, nextDayChips, quarterHourOptions } from './dateTime';

type Props = {
  label: string;
  nowIso: string;
  timeZone: string;
  dateKey: string;
  time: string;
  busy: boolean;
  onDateChange: (dateKey: string) => void;
  onTimeChange: (time: string) => void;
};

export function DateTimeFields({
  label,
  nowIso,
  timeZone,
  dateKey,
  time,
  busy,
  onDateChange,
  onTimeChange,
}: Props) {
  const theme = useTheme();
  const options = useMemo(() => quarterHourOptions(), []);
  const days = useMemo(() => {
    const upcoming = nextDayChips(nowIso, timeZone);
    return upcoming.some((day) => day.dateKey === dateKey)
      ? upcoming
      : [dayChipFor(dateKey, timeZone), ...upcoming];
  }, [dateKey, nowIso, timeZone]);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">{label} day</Text>
        <ScrollView horizontal contentContainerStyle={{ gap: theme.spacing.sm }}>
          {days.map((day) => (
            <Button
              key={day.dateKey}
              label={day.label}
              variant={day.dateKey === dateKey ? 'primary' : 'secondary'}
              onPress={() => onDateChange(day.dateKey)}
              disabled={busy}
              accessibilityLabel={`${label} date ${day.label}`}
            />
          ))}
        </ScrollView>
      </View>

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label">{label} time (15-minute steps)</Text>
        <ScrollView horizontal contentContainerStyle={{ gap: theme.spacing.sm }}>
          {options.map((option) => (
            <Button
              key={option}
              label={option}
              variant={option === time ? 'primary' : 'secondary'}
              onPress={() => onTimeChange(option)}
              disabled={busy}
              accessibilityLabel={`${label} time ${option}`}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}
