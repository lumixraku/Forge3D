// A pending user-selection request is answered either by the stored selection
// (once the turn moved on) or by what is currently ticked in the composer.
export function selectedOptionIds(message, selectedOptions: Record<string, string[]>) {
  return message.selection?.selected_option_ids || selectedOptions[message.turnId] || []
}

export function canContinueSelection(message, selectedOptions: Record<string, string[]>) {
  const count = selectedOptionIds(message, selectedOptions).length
  return count >= message.request.min && count <= message.request.max
}

/**
 * Reconciles restored turns against the bubbles already on screen.
 *
 * `additions` are turns with no bubble at all. `repairs` are the subtle case: a
 * bubble exists but has no card, because it was created when the message was sent
 * and the `request_user_select` that would have filled it in never arrived — the
 * event channel replays nothing, so one pushed while the connection was down is
 * gone for good. The turn is the authority. Without the repair the server waits
 * in waiting_for_user while the user watches a bubble that never resolves.
 */
export function reconcileRestoredTurns(messages, turns) {
  const additions = []
  const repairs = []
  for (const turn of turns) {
    const existing = messages.find((item) => item.turnId === turn.id)
    if (!existing) {
      additions.push(turn)
      continue
    }
    if (turn.request && !existing.request) repairs.push({ message: existing, request: turn.request })
  }
  return { additions, repairs }
}
