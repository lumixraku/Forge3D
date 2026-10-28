import { derived, state } from '../store'

/**
 * Harness build: there is no composer.
 *
 * The plugin is resolved to this module instead of `composer`, so the editor
 * stack never enters its module graph. The shape is identical and every value is
 * inert: nothing in a harness build ever types into it, because the in-app
 * copilot panel is not part of that build either.
 */
export function createComposer() {
  const composer = state(null)
  return {
    composer,
    composerHasContent: derived(() => false),
    composerMessage: () => '',
    composerAttachments: () => [],
    clearComposer: () => {},
    addComposerFiles: async () => {},
  }
}
