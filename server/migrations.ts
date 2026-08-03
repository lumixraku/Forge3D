// Pure data migrations, shared by both runtimes. Kept out of store.ts because
// that module imports node:fs and the Worker cannot load it.

/**
 * Renames the turn fields left behind by the conversation -> thread -> session
 * renames, and restores a session id from the turn's own result when the field
 * itself is missing. Returns each turn unchanged when there is nothing to do, so
 * callers can detect "no migration needed" by identity.
 */
/**
 * Renames the `workflowId` / `workflowRevision` fields left behind by the
 * workflow -> canvas rename (263b56e), which renamed the collections but
 * shipped no data migration, so the deployed rows still carry the old names.
 * Returns each record unchanged when there is nothing to do, so callers can
 * detect "no migration needed" by identity.
 */
export function migrateCanvasRefs(records) {
  return records.map((record) => {
    if (record.workflowId === undefined && record.workflowRevision === undefined) return record
    const migrated = structuredClone(record)
    if (migrated.canvasId === undefined && migrated.workflowId !== undefined) migrated.canvasId = migrated.workflowId
    if (migrated.canvasRevision === undefined && migrated.workflowRevision !== undefined) migrated.canvasRevision = migrated.workflowRevision
    delete migrated.workflowId
    delete migrated.workflowRevision
    return migrated
  })
}

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
