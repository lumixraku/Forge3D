# Progress

## 2026-08-05 - main

- Changed the chat composer to use one action button that switches between Send, Stop, and Stopping states.
- Preserved the existing send and stop-turn events and their disabled behavior.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. Browser inspection confirmed exactly one composer action button and no console errors.
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
