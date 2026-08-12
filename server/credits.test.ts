import assert from 'node:assert/strict'
import test from 'node:test'
import { accountDto, defaultAccount, reserveExecutionCredits, settleExecutionCredits } from './credits.js'

function state(balance = 1000) {
  return { accounts: [{ ...defaultAccount(), balance }], creditLedger: [] }
}

test('reserves one fixed execution charge per run', () => {
  const current = state()
  const run = { id: 'run-1', status: 'queued' }

  reserveExecutionCredits(current, run, () => 'now')
  reserveExecutionCredits(current, run, () => 'later')

  assert.equal(accountDto(current).balance, 990)
  assert.deepEqual(current.creditLedger, [{
    id: 'charge-run-1',
    accountId: 'demo-user',
    runId: 'run-1',
    type: 'execution_charge',
    amount: -10,
    createdAt: 'now',
  }])
})

test('rejects an execution before charging when the balance is insufficient', () => {
  const current = state(9)

  assert.throws(() => reserveExecutionCredits(current, { id: 'run-1' }), (error) => {
    assert.equal(error.statusCode, 402)
    assert.match(error.message, /Insufficient credits/)
    return true
  })
  assert.equal(accountDto(current).balance, 9)
  assert.deepEqual(current.creditLedger, [])
})

test('refunds failed and cancelled executions once by run id', () => {
  const current = state()
  const run = { id: 'run-1', status: 'queued' }
  reserveExecutionCredits(current, run, () => 'charged')

  run.status = 'failed'
  assert.equal(settleExecutionCredits(current, run, () => 'refunded'), true)
  assert.equal(settleExecutionCredits(current, run, () => 'later'), false)
  assert.equal(accountDto(current).balance, 1000)
  assert.equal(current.creditLedger.filter((entry) => entry.type === 'execution_refund').length, 1)
})

test('keeps the charge for successful executions', () => {
  const current = state()
  const run = { id: 'run-1', status: 'queued' }
  reserveExecutionCredits(current, run)
  run.status = 'succeeded'

  assert.equal(settleExecutionCredits(current, run), false)
  assert.equal(accountDto(current).balance, 990)
})
