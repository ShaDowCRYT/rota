import { describe, expect, it } from 'vitest';

import { inviteEmail, inviteEmailIsValid, shareInviteLink } from './inviteDraft';

describe('inviteDraft', () => {
  it('allows a blank email and omits it from the request', () => {
    expect(inviteEmailIsValid('   ')).toBe(true);
    expect(inviteEmail('   ')).toBeUndefined();
  });

  it('normalizes a valid optional email', () => {
    expect(inviteEmailIsValid(' Person@Example.COM ')).toBe(true);
    expect(inviteEmail(' Person@Example.COM ')).toBe('person@example.com');
  });

  it('rejects an invalid email', () => {
    expect(inviteEmailIsValid('not-an-email')).toBe(false);
  });

  it('shares a short message with the invite link', () => {
    expect(shareInviteLink('rota://invite?token=test')).toEqual({
      message:
        "Join my team on Rota. Open the app, tap 'Join a team with an invite link', and paste this link: rota://invite?token=test",
    });
  });
});
