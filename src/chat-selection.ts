// A pending user-selection request is answered either by the stored selection
// (once the turn moved on) or by what is currently ticked in the composer.
export function selectedOptionIds(message, selectedOptions: Record<string, string[]>) {
  return message.selection?.selected_option_ids || selectedOptions[message.turnId] || []
}

export function canContinueSelection(message, selectedOptions: Record<string, string[]>) {
  const count = selectedOptionIds(message, selectedOptions).length
  return count >= message.request.min && count <= message.request.max
}
