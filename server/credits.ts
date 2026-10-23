export const DEFAULT_ACCOUNT_ID = 'demo-user'
export const EXECUTION_CREDIT_COST = 10

export function defaultAccount(id = DEFAULT_ACCOUNT_ID) {
  return {
    id,
    name: 'Visitor',
    balance: 1000,
  }
}

export function accountDto(state, visitorId = DEFAULT_ACCOUNT_ID) {
  if (!visitorId) return null
  return state.accounts.find((account) => account.id === visitorId) || null
}

export function ensureVisitorAccount(state, visitorId) {
  const existing = accountDto(state, visitorId)
  if (existing) return { account: existing, created: false }
  const account = defaultAccount(visitorId)
  state.accounts.push(account)
  return { account, created: true }
}

export function reserveExecutionCredits(state, run, now = () => new Date().toISOString(), visitorId = DEFAULT_ACCOUNT_ID) {
  const account = accountDto(state, visitorId)
  if (!account) throw new Error('Visitor account is unavailable')
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
  const charged = state.creditLedger.find((entry) => entry.runId === run.id && entry.type === 'execution_charge')
  const refunded = state.creditLedger.some((entry) => entry.runId === run.id && entry.type === 'execution_refund')
  if (!charged || refunded) return false

  const account = accountDto(state, charged.accountId)
  if (!account) throw new Error('Visitor account is unavailable')
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
