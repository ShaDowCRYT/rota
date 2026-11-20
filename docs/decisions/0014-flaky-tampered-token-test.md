# 0014: Flaky tampered-token test

Status: Accepted
Date: 2026-11-20
Source: Phase 1, slice 2 (basic authentication test hardening)

## Problem

The test `a tampered token returns 401` changed only the last character of the JWT signature. A 32-byte signature becomes 43 base64url characters; the last character has 4 meaningful bits and 2 padding bits. `jose` accepted alternate last characters that decode to the same signature bytes, so about 1 in 16 tokens made the test expect 401 but receive 200.

## Options

1. **Change a middle payload character and keep the old signature.** Chosen. A middle character has no padding bits, so a different character always changes the signed bytes.
2. **Flip a bit in the first byte of the decoded signature and re-encode it.** Also valid, but more code for the same result.
3. **Keep changing the last signature character.** Rejected: the result depends on the token's final character.

## Decision

- Only the test was changed. Production code was not changed.
- `tamperPayload()` changes one middle payload character to the next base64url character, keeps the header and signature, and the test asserts the token string is different.
- Two more tests were added: a payload with a different `sub` (user id) and the old signature, and a token with the signature removed. Both expect 401.

## Why

- The old test failed intermittently in CI; the new tamper is deterministic.
- The production verifier still rejects every real change: 0 of 63 changed first-signature characters and 0 of 63 changed middle-payload characters were accepted in the one-off check.
- Accepting alternate spellings of the same signature bytes does not change identity or permissions, so no production change was justified here.

## When to revisit

- If a future JWT library starts rejecting non-canonical base64url strictly, re-run the one-off check to confirm the counts.
- If the project ever requires canonical token strings at the API boundary, make that a separate production decision, not a test-only change.
- Re-check this decision if the token signing algorithm or payload format changes.
