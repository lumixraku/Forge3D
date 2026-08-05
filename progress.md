# Progress

## 2026-08-05 - main

- Changed the chat composer to use one action button that switches between Send, Stop, and Stopping states.
- Preserved the existing send and stop-turn events and their disabled behavior.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection confirmed exactly one composer action button and no console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Reverted the added outer chat-message frames and restored the original message spacing and user bubble treatment; user-selection cards retain their existing borders.
- Kept the top-bar control sizing normalization unchanged.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Normalized top-bar button group heights and minimum widths so the canvas switcher, workspace switcher, theme switcher, and canvas tools align consistently.
- Added a consistent subtle border and surface to every chat message, including assistant messages, while preserving the stronger user-message treatment.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Cherry-picked Tripo commit `5265573` from merge commit `5014ba7e43092b1c2af3b8d5e9d34b2b60196fc0` to simplify agent selection recovery.
- Integrated it with the durable harness by preventing startup recovery from re-queuing turns that already have a pending user-selection request.
- Verification: `pnpm test` passed 193 tests; `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Removed the composer keyboard shortcut hint and replaced the attachment and send/stop text controls with circular icon buttons.
- Kept the right-hand control as one button that switches from a send arrow to a stop square while an agent turn is running.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection confirmed the hint is absent, both controls are 34px circles with SVG icons, and there are no console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Refined the composer into a compact 99px control and grouped the attachment and send/stop actions at the lower right instead of stretching them across the panel.
- Reduced both icon buttons to 30px, softened the attachment control, and tightened the focus treatment and internal spacing.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection confirmed the compact dimensions, right-aligned controls, and no console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Stopped downloading new Tripo outputs into server storage and retained each Tripo task ID as the stable reference for exports.
- Added an owned-task download endpoint that refreshes the task on demand and redirects to its current model URL without proxying or caching the asset bytes; retained the legacy local asset reader for older runs.
- Added regression coverage for refreshed downloads, task ownership, stable export links, and non-persisted Tripo results.
- Verification: `pnpm test` passed 195 tests; `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Remaining issues: Tripo preview image URLs are still the temporary URLs returned when a task completes; only model downloads are refreshed on demand.
