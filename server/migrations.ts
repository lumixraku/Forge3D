// Pure data migrations, shared by both runtimes. Kept out of store.ts because
// that module imports node:fs and the Worker cannot load it.

/**
 * Renames the turn fields left behind by the conversation -> thread -> session
 * renames, and restores a session id from the turn's own result when the field
 * itself is missing. Returns each turn unchanged when there is nothing to do, so
 * callers can detect "no migration needed" by identity.
 */
export function migrateTurns(turns) {
  return turns.map((turn) => {
    if (!turn.conversationId && !turn.threadId && !turn.result?.conversation && !turn.result?.thread && (turn.sessionId || !turn.result?.session?.id)) return turn
    const migrated = structuredClone(turn)
    if (!migrated.sessionId) migrated.sessionId = migrated.threadId || migrated.conversationId
    delete migrated.threadId
    delete migrated.conversationId
    if (migrated.result) {
      if (!migrated.result.session) migrated.result.session = migrated.result.thread || migrated.result.conversation
      delete migrated.result.thread
      delete migrated.result.conversation
    }
    if (!migrated.sessionId && migrated.result?.session?.id) migrated.sessionId = migrated.result.session.id
    return migrated
  })
}
