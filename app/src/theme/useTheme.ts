import { useColorScheme } from 'react-native';
import { getTheme } from './tokens';

export function useTheme() {
  const scheme = useColorScheme();
  return getTheme(scheme === 'dark' ? 'dark' : 'light');
}
