# Progress

## 2026-08-07 - main

- Removed the uninformative `Editable parameters` footer from nodes that have no run record; the footer remains available for actual run messages and durations.
- Verification: `pnpm run typecheck`, `pnpm run build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-07 - main

- Increased simulated node execution time from 600 ms to 5 seconds so mock runs keep their executing-state feedback visible long enough to inspect.
- Verification: `pnpm run typecheck`, `node --import tsx --test server/mock-runs.test.ts` (10 tests), `pnpm run build`, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-07 - main

- Added a prominent percentage progress bar to every executing node result state, using the existing Tripo API progress value and an indeterminate fallback for providers without percentages.
- Added a pulsing glow and expanding halo to the executing node's right output port, with reduced-motion handling.
- Verification: `pnpm run typecheck`, `pnpm run build`, `pnpm test` (197 tests), and `git diff --check` passed. Browser verification against a live Tripo execution confirmed progress updates reached the running node.
- Remaining issues: The existing local development tab was serving an older hot-reloaded component bundle, so the new CSS animation itself was verified through the production build rather than that tab.

## 2026-08-06 - main

- Prevented native browser viewport pinch zoom across the application UI while preserving Vue Flow's canvas-owned pinch zoom and trackpad pinch handling inside `.flow-canvas`.
- Verification: `pnpm typecheck`, `pnpm build`, and `git diff --check` passed. The existing local browser tab was running an older bundle, so physical two-finger gesture verification was not available from that session.
- Remaining issues: None.

## 2026-08-05 - main

- Replaced the README product screenshot with the user-provided clipboard capture, which shows a completed conversational 3D reconstruction workflow, Agent tool activity, and the canvas output together.
- Verification: exported the clipboard PNG successfully as `assets/forge3d-canvas-studio.png` (2788x1700) and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Repositioned the root README as a DeepSeek Agent Harness reference: documented its dual runtime, durable turns and checkpoints, validated shared tools, human-in-the-loop continuation, canvas-scoped SSE, authoritative state reconciliation, and real Tripo-backed workflow execution.
- Added an architecture table, end-to-end execution flow, tool summary, accurate local runtime instructions, known constraints, and prominent links to the implementation-level documentation.
- Verification: `pnpm test` passed 197 tests, `pnpm typecheck` passed, `pnpm build` passed (with Vite's existing large-chunk warning), and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Replaced the main product screenshot with a light-mode capture and added it to the README introduction.
- Verification: confirmed the `LIGHT` theme was selected in Chrome, the screenshot is 3840x1632, no browser console errors were present, and `git diff --check` passed.
- Remaining issues: None.

## 2026-08-05 - main

- Added a local `POST /api/assets` upload path that writes user files into the existing hashed asset cache and returns a durable `/api/assets/<hash>.<extension>` URL.
- Changed chat attachments to upload before insertion, so message metadata persists the server URL rather than a browser-only Data URL; uploaded images are now readable through the existing static asset route.
- Added coverage for storing an uploaded image. Verification: `pnpm run typecheck`, `pnpm test` passed 197 tests, `git diff --check` passed, and a browser upload of `shark-reference.png` returned and served `/api/assets/b86db8acfe21956a64387b562ab1350a.png` as `image/png`.
- Remaining issues: The Cloudflare Worker has no binary object-storage binding, so this upload route is intentionally available only from the Node server until an R2 bucket is configured.

## 2026-08-05 - main

- Committed the existing attachment card and responsive chat styling changes together with the previously completed port fallback work.
- Verification: `pnpm run typecheck`, `pnpm test` passed 196 tests, and `git diff --check` passed.
- Remaining issues: User-uploaded image thumbnails still use client-side data URLs and do not yet have a server-hosted static URL upload flow.

## 2026-08-05 - main

- Reworked chat attachment rendering so sent user messages retain image thumbnails and file metadata instead of displaying raw attachment text only.
- Added compact attachment cards with constrained filenames, safe wrapping, image preview links, and responsive user-message bubbles.
- Added client-side image thumbnails suitable for durable chat history and preserved attachment metadata through the turn API.
- Verification: `pnpm run typecheck`, `pnpm test` passed 196 tests, and `git diff --check` passed. Browser inspection confirmed the updated chat layout loads without console errors.
- Remaining issues: None.

## 2026-08-05 - main

- Added automatic port probing for both Node HTTP services, incrementing on `EADDRINUSE` instead of crashing.
- Updated `pnpm run dev` to reserve available API and agent-service ports, pass them to child processes, and configure the Vite API proxy with the resolved API port.
- Added a regression test for Node port fallback.
- Verification: `pnpm run typecheck`, `node --import tsx --test server/listen.test.ts`, `git diff --check`, and an end-to-end `pnpm run dev` startup check passed. Existing occupied ports were skipped successfully.
- Remaining issues: None.

## 2026-08-05 - main

- Enabled Vite's built-in port fallback so the web dev server increments from port 5175 when the requested port is occupied.
- Verification: `pnpm run typecheck` passed. An integration check occupied port 5175 and confirmed `pnpm run dev:web` started on port 5176.
- Remaining issues: None.

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
