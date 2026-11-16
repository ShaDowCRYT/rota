# 0008: Design in code

Status: Accepted
Date: 2026-11-16
Source: Phase 0, app foundations

## Problem

Rota needs a clear and consistent look, but the current phase is focused on building a working app foundation. We need to decide whether to design screens in Figma first or define the design directly in code.

## Options

1. **Design in code with tokens and shared components first.** Chosen.
2. **Create full Figma designs before building screens.** Gives visual planning, but adds extra work and can drift from the real app.
3. **Style each screen directly with no shared tokens.** Fast at first, but leads to inconsistent colors, spacing, and repeated fixes.

## Decision

- No Figma for Rota.
- Design is built in code with tokens first (`app/src/theme/tokens.ts`) and shared components (`app/src/components`).
- Screens use tokens only for colors, type, spacing, radii, and shadows, and build from shared components.

## Why

- The Rota task is judged on depth, and tokens and shared components keep the UI consistent without a design file.
- A single token file makes light/dark support and later visual changes easier because values change in one place.
- Shared components reduce duplicated styling and help every screen keep the same loading, error, and interaction patterns.

## When to revisit

- Matinee uses Figma first, as the task requires.
- Revisit if Rota needs a designer handoff, a larger visual redesign, or many new screens that benefit from upfront mockups.
