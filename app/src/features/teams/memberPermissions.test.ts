import { describe, expect, it } from 'vitest';

import { canInviteMembers, canManageMember } from './memberPermissions';

describe('memberPermissions', () => {
  it('shows invite only to the owner', () => {
    expect(canInviteMembers('owner')).toBe(true);
    expect(canInviteMembers('manager')).toBe(false);
    expect(canInviteMembers('staff')).toBe(false);
    expect(canInviteMembers(undefined)).toBe(false);
  });

  it('shows member actions only for non-owner members to the owner', () => {
    expect(canManageMember('owner', 'manager')).toBe(true);
    expect(canManageMember('owner', 'staff')).toBe(true);
    expect(canManageMember('owner', 'owner')).toBe(false);
    expect(canManageMember('manager', 'staff')).toBe(false);
    expect(canManageMember(undefined, 'staff')).toBe(false);
  });
});
