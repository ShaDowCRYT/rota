# Rota workflow

## Everyday rules

- Do not ask questions unless a real decision is missing. If a choice is not covered by the PRD, `AGENTS.md`, or `docs/decisions`, pick the simplest option that follows the rules, and list it under "Choices I made" in the summary.
- While building, run only the targeted tests. Run `node scripts/verify.mjs` ONCE at the end.
- Evidence: show it only for the PRD requirement IDs in the task. Use real-database or real-Redis proofs ONLY for money, authentication, team isolation, idempotency, and concurrency. Everything else uses fakes.
- Tests must pass with no `.env` file and no environment variables.

## Finish every task with

- The checklist (Met or Not met, with evidence).
- A summary of at most 8 lines in simple English: what was built, how to approach it, the task re-explained.
- The "Choices I made" list.
- One decision record for the slice ONLY if a new decision was made.
- A reminder to write a 3 to 4 line learning log entry in your own words.

## Commit and push (only when asked)

- Run `node scripts/verify.mjs` first; stop if it fails.
- Make grouped Conventional Commits by folder. Never use `git add .` or `git add -A`.
- Check that no `.env` file and no secret pattern is staged.
- Push, then show `git log --oneline -6` and `git status`.
