import test from 'node:test'
import assert from 'node:assert/strict'
import { canContinueSelection, reconcileRestoredTurns, selectedOptionIds } from './chat-selection.js'

test('a stored selection wins over what is currently ticked', () => {
  const message = { turnId: 't1', selection: { selected_option_ids: ['a'] } }

  assert.deepEqual(selectedOptionIds(message, { t1: ['b'] }), ['a'])
  assert.deepEqual(selectedOptionIds({ turnId: 't1' }, { t1: ['b'] }), ['b'])
  assert.deepEqual(selectedOptionIds({ turnId: 't1' }, {}), [])
})

test('continuing needs a tick count inside the request bounds', () => {
  const message = { turnId: 't1', request: { min: 1, max: 2 } }

  assert.equal(canContinueSelection(message, { t1: [] }), false)
  assert.equal(canContinueSelection(message, { t1: ['a'] }), true)
  assert.equal(canContinueSelection(message, { t1: ['a', 'b'] }), true)
  assert.equal(canContinueSelection(message, { t1: ['a', 'b', 'c'] }), false)
})

test('a turn with no bubble is added', () => {
  const turns = [{ id: 't1', request: { request_id: 'r1' } }]

  const { additions, repairs } = reconcileRestoredTurns([], turns)

  assert.deepEqual(additions, turns)
  assert.deepEqual(repairs, [])
})

// The dropped-card case: the event channel replays nothing, so a
// `request_user_select` pushed while the connection was down never lands. The
// bubble is already on screen from sending the message, so it is not an addition —
// only the turn knows a card is waiting.
test('a bubble that exists without its card is repaired from the turn', () => {
  const messages = [{ turnId: 't1', role: 'assistant', pending: true, request: null }]
  const turns = [{ id: 't1', request: { request_id: 'r1' } }]

  const { additions, repairs } = reconcileRestoredTurns(messages, turns)

  assert.deepEqual(additions, [])
  assert.equal(repairs.length, 1)
  assert.equal(repairs[0].message, messages[0])
  assert.deepEqual(repairs[0].request, { request_id: 'r1' })
})

test('a bubble that already shows its card is left alone', () => {
  const messages = [{ turnId: 't1', request: { request_id: 'r1' } }]
  const turns = [{ id: 't1', request: { request_id: 'r1' } }]

  const { additions, repairs } = reconcileRestoredTurns(messages, turns)

  assert.deepEqual(additions, [])
  assert.deepEqual(repairs, [])
})

test('a turn still running is neither added twice nor repaired', () => {
  const messages = [{ turnId: 't1', pending: true, request: null }]
  const turns = [{ id: 't1', request: null }]

  const { additions, repairs } = reconcileRestoredTurns(messages, turns)

  assert.deepEqual(additions, [])
  assert.deepEqual(repairs, [])
})
