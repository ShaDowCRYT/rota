export type ThemeName = 'light' | 'dark';

export type ThemeColors = {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  border: string;
  success: string;
  warning: string;
  error: string;
};

const lightColors: ThemeColors = {
  background: '#F4F6F8',
  surface: '#FFFFFF',
  text: '#102027',
  textMuted: '#546E7A',
  primary: '#0F766E',
  onPrimary: '#FFFFFF',
  secondary: '#E0F2F1',
  onSecondary: '#0F766E',
  border: '#D7DEE3',
  success: '#2E7D32',
  warning: '#B45309',
  error: '#B42318',
};

const darkColors: ThemeColors = {
  background: '#0F1720',
  surface: '#18232E',
  text: '#E6EDF3',
  textMuted: '#9FB3C1',
  primary: '#2DD4BF',
  onPrimary: '#062925',
  secondary: '#1F3A3A',
  onSecondary: '#A7F3D0',
  border: '#2C3A46',
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',
};

export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

export const typeScale = {
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700' as const },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
} as const;

export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
} as const;

export const sizes = {
  touchTargetMin: 44,
  borderWidth: 1,
} as const;

export const layout = {
  fill: 1,
} as const;

export const opacity = {
  enabled: 1,
  pressed: 0.7,
  disabled: 0.6,
} as const;

export type AppTheme = {
  name: ThemeName;
  colors: ThemeColors;
  spacing: typeof spacing;
  radii: typeof radii;
  typeScale: typeof typeScale;
  shadows: typeof shadows;
  sizes: typeof sizes;
  layout: typeof layout;
  opacity: typeof opacity;
};

export const lightTheme: AppTheme = {
  name: 'light',
  colors: lightColors,
  spacing,
  radii,
  typeScale,
  shadows,
  sizes,
  layout,
  opacity,
};

export const darkTheme: AppTheme = {
  name: 'dark',
  colors: darkColors,
  spacing,
  radii,
  typeScale,
  shadows,
  sizes,
  layout,
  opacity,
};

export function getTheme(name: ThemeName): AppTheme {
  return name === 'dark' ? darkTheme : lightTheme;
}
