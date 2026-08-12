export const DEFAULT_ACCOUNT_ID = 'demo-user'
export const EXECUTION_CREDIT_COST = 10

export function defaultAccount() {
  return {
    id: DEFAULT_ACCOUNT_ID,
    name: 'Demo User',
    balance: 1000,
  }
}

export function accountDto(state) {
  return state.accounts.find((account) => account.id === DEFAULT_ACCOUNT_ID) || null
}

export function reserveExecutionCredits(state, run, now = () => new Date().toISOString()) {
  const account = accountDto(state)
  if (!account) throw new Error('Default account is unavailable')
  if (state.creditLedger.some((entry) => entry.runId === run.id && entry.type === 'execution_charge')) return account
  if (account.balance < EXECUTION_CREDIT_COST) {
    const error = new Error(`Insufficient credits. This execution costs ${EXECUTION_CREDIT_COST} credits.`)
    error.statusCode = 402
    throw error
  }

  account.balance -= EXECUTION_CREDIT_COST
  state.creditLedger.push({
    id: `charge-${run.id}`,
    accountId: account.id,
    runId: run.id,
    type: 'execution_charge',
    amount: -EXECUTION_CREDIT_COST,
    createdAt: now(),
  })
  return account
}

export function settleExecutionCredits(state, run, now = () => new Date().toISOString()) {
  if (!['failed', 'cancelled'].includes(run?.status)) return false
  const charged = state.creditLedger.some((entry) => entry.runId === run.id && entry.type === 'execution_charge')
  const refunded = state.creditLedger.some((entry) => entry.runId === run.id && entry.type === 'execution_refund')
  if (!charged || refunded) return false

  const account = accountDto(state)
  if (!account) throw new Error('Default account is unavailable')
  account.balance += EXECUTION_CREDIT_COST
  state.creditLedger.push({
    id: `refund-${run.id}`,
    accountId: account.id,
    runId: run.id,
    type: 'execution_refund',
    amount: EXECUTION_CREDIT_COST,
    createdAt: now(),
  })
  return true
}
