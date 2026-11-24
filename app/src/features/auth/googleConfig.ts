export function getGoogleWebClientId(): string | null {
  const value = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  return value ? value : null;
}
