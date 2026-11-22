export async function assertSeatAvailable(_teamId: string): Promise<void> {
  // Billing (Phase 5) will enforce seat limits; this hook allows all invites until then.
}
