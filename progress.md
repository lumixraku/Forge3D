# Progress

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
