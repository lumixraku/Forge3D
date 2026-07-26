import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createStore } from './store.js'
import { createFragment, fragmentSummary } from './fragments.js'
import { createMockRun, downstreamWorkflow, executeMockRun } from './mock-runs.js'
import { latestNodeRuns } from './node-state.js'
import { createInitialConversation, createWorkflow } from './workflows.js'
import { runDeepSeekAgent } from './deepseek.js'

const port = Number(process.env.PORT || 8787)
const { state, persist } = await createStore()
const workflowTaskQueues = new Map()

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function openSse(response) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
}

function taskEvent(task, type, fields = {}) {
  task.eventId = (task.eventId || 0) + 1
  return {
    id: `${task.eventId}-0`,
    data: { type, thread_id: task.threadId, turn_id: task.id, ...fields },
  }
}

function writeSse(response, event) {
  response.write(`event: ${event.data.type === 'error' ? 'error' : 'message'}\ndata: ${JSON.stringify(event.data)}\nid: ${event.id}\n\n`)
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function route(request) {
  return new URL(request.url, `http://${request.headers.host}`).pathname.split('/').filter(Boolean)
}

function workflowById(id) {
  return state.workflows.find((workflow) => workflow.id === id)
}

function runById(workflowId, runId) {
  return state.runs.find((run) => run.id === runId && run.workflowId === workflowId)
}

function conversationFor(workflowId) {
  return state.conversations.find((conversation) => conversation.workflowId === workflowId)
}

function fragmentById(id) {
  return state.fragments.find((fragment) => fragment.id === id || fragment.shareId === id)
}

function taskById(id) {
  return state.tasks.find((task) => task.id === id)
}

async function executeAgentTask(task, emit = async () => {}) {
  try {
    task.status = 'running'
    task.startedAt = new Date().toISOString()
    await persist('tasks')
    await emit(taskEvent(task, 'task-start', { workflow_id: task.workflowId }))
    const workflow = workflowById(task.workflowId)
    if (!workflow) throw new Error('Workflow not found')
    const conversation = conversationFor(task.workflowId)
    const plan = await runDeepSeekAgent({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL,
      model: process.env.DEEPSEEK_MODEL,
      message: task.selection ? `${task.message}\n\nThe user selected: ${task.selection.selected_option_ids.map((optionId) => task.request.options.find((option) => option.id === optionId)?.label || optionId).join(', ')}. Continue the task using this selection.` : task.message,
      workflow,
      history: conversation?.messages || [],
      onProgress: async (event) => {
        task.progress.push(event)
        task.updatedAt = new Date().toISOString()
        await persist('tasks')
        await emit(taskEvent(task, 'progress', { step_id: `progress-${task.progress.length}`, ...event }))
      },
    })
    if (plan.userSelectionRequest) {
      task.status = 'waiting_for_user'
      delete task.selection
      task.request = { request_id: `request-${randomUUID()}`, ...plan.userSelectionRequest }
      const now = new Date().toISOString()
      const conversationIndex = state.conversations.findIndex((item) => item.workflowId === task.workflowId)
      const nextConversation = conversationIndex < 0
        ? { id: task.threadId, workflowId: task.workflowId, messages: [], createdAt: now }
        : structuredClone(state.conversations[conversationIndex])
      if (!nextConversation.messages.some((message) => message.taskId === task.id && message.role === 'user')) {
        nextConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: task.message, taskId: task.id, createdAt: now })
      }
      const requestMessage = { id: `msg-${randomUUID()}`, role: 'assistant', content: '', taskId: task.id, request: task.request, progress: task.progress, createdAt: now }
      nextConversation.messages.push(requestMessage)
      nextConversation.updatedAt = now
      task.requestMessageId = requestMessage.id
      task.updatedAt = new Date().toISOString()
      if (conversationIndex < 0) state.conversations.push(nextConversation)
      else state.conversations[conversationIndex] = nextConversation
      await Promise.all([persist('conversations'), persist('tasks')])
      await emit(taskEvent(task, 'request_user_select', { request: task.request }))
      return
    }
    const workflowIndex = state.workflows.findIndex((item) => item.id === plan.workflow.id)
    if (workflowIndex < 0) state.workflows.push(plan.workflow)
    else state.workflows[workflowIndex] = plan.workflow

    let nextConversation = conversationFor(plan.workflow.id)
    if (!nextConversation) {
      nextConversation = { id: `conv-${randomUUID()}`, workflowId: plan.workflow.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] }
      state.conversations.push(nextConversation)
    }
    const now = new Date().toISOString()
    const assistantMessageId = `msg-${randomUUID()}`
    if (!task.requestMessageId) nextConversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: task.message, createdAt: now })
    nextConversation.messages.push({ id: assistantMessageId, role: 'assistant', content: plan.reply, progress: task.progress, createdAt: now })
    nextConversation.updatedAt = now
    task.status = 'succeeded'
    task.result = structuredClone({ ...plan, conversation: nextConversation })
    task.completedAt = new Date().toISOString()
    task.updatedAt = task.completedAt
    await Promise.all([persist('workflows'), persist('conversations'), persist('tasks')])
    await emit(taskEvent(task, 'text', { step_id: 'final-response', id: assistantMessageId, text: plan.reply }))
    await emit(taskEvent(task, 'workflow-updated', { workflow_id: task.workflowId, changed_node_ids: plan.changedNodeIds, structure_changed: plan.structureChanged }))
    await emit(taskEvent(task, 'finish', { finish_reason: 'stop' }))
  } catch (error) {
    task.status = 'failed'
    task.error = error.message
    task.completedAt = new Date().toISOString()
    task.updatedAt = task.completedAt
    try {
      await persist('tasks')
    } catch {
      // Keep the terminal status in memory if persistence itself fails.
    }
    await emit(taskEvent(task, 'error', { error: task.error }))
  }
}

function enqueueAgentTask(task, emit) {
  const previous = workflowTaskQueues.get(task.workflowId) || Promise.resolve()
  const current = previous
    .catch(() => {})
    .then(() => executeAgentTask(task, emit))
    .finally(() => {
      if (workflowTaskQueues.get(task.workflowId) === current) workflowTaskQueues.delete(task.workflowId)
    })
  workflowTaskQueues.set(task.workflowId, current)
  return current
}

const server = createServer(async (request, response) => {
  try {
    const parts = route(request)
    if (parts[0] !== 'api') return json(response, 404, { error: 'Not found' })

    if (request.method === 'GET' && parts[1] === 'workflows' && parts.length === 2) {
      return json(response, 200, state.workflows.map(({ nodes, edges, ...workflow }) => ({ ...workflow, nodeCount: nodes.length, edgeCount: edges.length })))
    }

    if (request.method === 'POST' && parts[1] === 'workflows' && parts.length === 2) {
      const workflow = createWorkflow(await body(request))
      const conversation = createInitialConversation(workflow)
      state.workflows.push(workflow)
      state.conversations.push(conversation)
      await Promise.all([persist('workflows'), persist('conversations')])
      return json(response, 201, workflow)
    }

    if (request.method === 'GET' && parts[1] === 'fragments' && parts.length === 2) {
      return json(response, 200, state.fragments.map(fragmentSummary))
    }

    if (request.method === 'GET' && parts[1] === 'fragments' && parts.length === 3) {
      const fragment = fragmentById(parts[2])
      if (!fragment) return json(response, 404, { error: 'Fragment not found' })
      return json(response, 200, fragment)
    }

    if (request.method === 'POST' && parts[1] === 'fragments' && parts.length === 2) {
      const fragment = createFragment(await body(request))
      state.fragments.push(fragment)
      await persist('fragments')
      return json(response, 201, fragment)
    }

    if (request.method === 'DELETE' && parts[1] === 'fragments' && parts.length === 3) {
      const index = state.fragments.findIndex((fragment) => fragment.id === parts[2])
      if (index < 0) return json(response, 404, { error: 'Fragment not found' })
      state.fragments.splice(index, 1)
      await persist('fragments')
      return json(response, 204, null)
    }

    if (request.method === 'GET' && parts[1] === 'workflows' && parts.length === 3) {
      const workflow = workflowById(parts[2])
      if (!workflow) return json(response, 404, { error: 'Workflow not found' })
      return json(response, 200, { workflow, conversation: conversationFor(workflow.id), nodeRuns: latestNodeRuns(workflow, state.runs) })
    }

    if (request.method === 'PUT' && parts[1] === 'workflows' && parts.length === 3) {
      const index = state.workflows.findIndex((workflow) => workflow.id === parts[2])
      if (index < 0) return json(response, 404, { error: 'Workflow not found' })
      const input = await body(request)
      state.workflows[index] = { ...input, id: parts[2], updatedAt: new Date().toISOString() }
      await persist('workflows')
      return json(response, 200, state.workflows[index])
    }

    if (request.method === 'DELETE' && parts[1] === 'workflows' && parts.length === 3) {
      const index = state.workflows.findIndex((workflow) => workflow.id === parts[2])
      if (index < 0) return json(response, 404, { error: 'Workflow not found' })
      state.workflows.splice(index, 1)
      state.conversations = state.conversations.filter((conversation) => conversation.workflowId !== parts[2])
      state.runs = state.runs.filter((run) => run.workflowId !== parts[2])
      await Promise.all([persist('workflows'), persist('conversations'), persist('runs')])
      return json(response, 204, null)
    }

    if (request.method === 'GET' && parts[1] === 'tasks' && parts.length === 3) {
      const task = taskById(parts[2])
      if (!task) return json(response, 404, { error: 'Task not found' })
      return json(response, 200, task)
    }

    if (request.method === 'GET' && parts[1] === 'tasks' && parts.length === 2) {
      const url = new URL(request.url, `http://${request.headers.host}`)
      const workflowId = url.searchParams.get('workflowId')
      const statuses = new Set((url.searchParams.get('status') || '').split(',').filter(Boolean))
      const tasks = state.tasks.filter((task) => (!workflowId || task.workflowId === workflowId) && (!statuses.size || statuses.has(task.status)))
      return json(response, 200, tasks)
    }

    if (request.method === 'POST' && parts[1] === 'tasks' && parts[3] === 'continue' && parts.length === 4) {
      const task = taskById(parts[2])
      if (!task) return json(response, 404, { error: 'Task not found' })
      const input = await body(request)
      const selectedOptionIds = input.selected_option_ids
      const existingSelection = task.selection
      if (existingSelection) {
        if (input.request_id === existingSelection.request_id && Array.isArray(selectedOptionIds) && selectedOptionIds.length === existingSelection.selected_option_ids.length && selectedOptionIds.every((optionId, index) => optionId === existingSelection.selected_option_ids[index])) {
          return json(response, 200, task)
        }
        return json(response, 409, { error: 'This selection was already submitted' })
      }
      if (task.status !== 'waiting_for_user' || !task.request || input.request_id !== task.request.request_id) return json(response, 409, { error: 'Task is not waiting for this selection' })
      if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((optionId) => typeof optionId !== 'string') || new Set(selectedOptionIds).size !== selectedOptionIds.length || selectedOptionIds.length < task.request.min || selectedOptionIds.length > task.request.max || selectedOptionIds.some((optionId) => !task.request.options.some((option) => option.id === optionId))) {
        return json(response, 400, { error: 'Selected options are invalid' })
      }
      task.selection = { request_id: task.request.request_id, selected_option_ids: selectedOptionIds }
      const conversation = state.conversations.find((item) => item.workflowId === task.workflowId)
      const requestMessage = conversation?.messages.find((message) => message.id === task.requestMessageId)
      const selectedLabels = selectedOptionIds.map((optionId) => task.request.options.find((option) => option.id === optionId).label)
      if (conversation && requestMessage) {
        requestMessage.selection = task.selection
        conversation.messages.push({ id: `msg-${randomUUID()}`, role: 'user', content: selectedLabels.join(', '), taskId: task.id, selection: task.selection, createdAt: new Date().toISOString() })
        conversation.updatedAt = new Date().toISOString()
      }
      task.status = 'queued'
      task.updatedAt = new Date().toISOString()
      await Promise.all([persist('conversations'), persist('tasks')])
      if (request.headers.accept?.includes('text/event-stream')) {
        openSse(response)
        enqueueAgentTask(task, (event) => writeSse(response, event))
          .catch(() => {})
          .finally(() => response.end())
        return
      }
      void enqueueAgentTask(task)
      return json(response, 202, task)
    }

    if (request.method === 'POST' && parts[1] === 'chat') {
      const input = await body(request)
      if (typeof input.message !== 'string' || !input.message.trim()) return json(response, 400, { error: 'message is required' })
      if (input.workflowId !== undefined && typeof input.workflowId !== 'string') return json(response, 400, { error: 'workflowId is invalid' })
      if (!process.env.DEEPSEEK_API_KEY) {
        const error = new Error('DeepSeek is not configured. Set DEEPSEEK_API_KEY and restart the API server.')
        error.statusCode = 503
        throw error
      }
      const existing = input.workflowId ? workflowById(input.workflowId) : createWorkflow({ name: 'New workflow', nodes: [], edges: [] })
      if (input.workflowId && !existing) {
        const error = new Error('Workflow not found')
        error.statusCode = 404
        throw error
      }
      if (!input.workflowId) {
        state.workflows.push(existing)
        state.conversations.push(createInitialConversation(existing))
      }
      const now = new Date().toISOString()
      const conversation = conversationFor(existing.id)
      const task = {
        id: `task-${randomUUID()}`,
        threadId: conversation?.id || `conv-${randomUUID()}`,
        workflowId: existing.id,
        message: input.message || '',
        status: 'queued',
        progress: [],
        eventId: 0,
        createdAt: now,
        updatedAt: now,
      }
      state.tasks.push(task)
      await Promise.all([persist('workflows'), persist('conversations'), persist('tasks')])
      if (request.headers.accept?.includes('text/event-stream')) {
        openSse(response)
        enqueueAgentTask(task, (event) => writeSse(response, event))
          .catch(() => {})
          .finally(() => response.end())
        return
      }
      void enqueueAgentTask(task)
      return json(response, 202, task)
    }

    if (request.method === 'POST' && parts[1] === 'workflows' && parts[3] === 'duplicate') {
      const source = workflowById(parts[2])
      if (!source) return json(response, 404, { error: 'Workflow not found' })
      const now = new Date().toISOString()
      const workflow = { ...structuredClone(source), id: `wf-${randomUUID()}`, name: `${source.name} Copy`, revision: 1, createdAt: now, updatedAt: now }
      state.workflows.push(workflow)
      state.conversations.push({ id: `conv-${randomUUID()}`, workflowId: workflow.id, createdAt: now, updatedAt: now, messages: [{ id: `msg-${randomUUID()}`, role: 'assistant', content: 'This workflow was duplicated and can now evolve independently.', createdAt: now }] })
      await Promise.all([persist('workflows'), persist('conversations')])
      return json(response, 201, workflow)
    }

    if (request.method === 'GET' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 5) {
      const workflow = workflowById(parts[2])
      if (!workflow) return json(response, 404, { error: 'Workflow not found' })
      const run = runById(workflow.id, parts[4])
      if (!run) return json(response, 404, { error: 'Run not found' })
      return json(response, 200, run)
    }

    if (request.method === 'POST' && parts[1] === 'workflows' && parts[3] === 'runs' && parts.length === 4) {
      const workflow = workflowById(parts[2])
      if (!workflow) return json(response, 404, { error: 'Workflow not found' })
      const { targetNodeId, scope = 'node' } = await body(request)
      const targetNode = targetNodeId ? workflow.nodes.find((node) => node.id === targetNodeId) : null
      if (targetNodeId && !targetNode) return json(response, 400, { error: 'Target node not found' })
      if (!['node', 'downstream'].includes(scope)) return json(response, 400, { error: 'Invalid run scope' })
      if (scope === 'downstream' && !targetNode) return json(response, 400, { error: 'A target node is required for downstream runs' })

      let executionWorkflow = structuredClone(workflow)
      if (scope === 'downstream') executionWorkflow = downstreamWorkflow(workflow, targetNodeId)
      else if (targetNode) {
        executionWorkflow.nodes = [structuredClone(targetNode)]
        executionWorkflow.edges = []
      }
      const run = createMockRun(executionWorkflow)
      state.runs.push(run)
      await persist('runs')
      void executeMockRun(run, executionWorkflow, { persist: () => persist('runs') }).catch(async (error) => {
        run.status = 'failed'
        run.completedAt = new Date().toISOString()
        run.error = error.message
        try {
          await persist('runs')
        } catch (persistError) {
          console.error(persistError)
        }
      })
      return json(response, 201, run)
    }

    return json(response, 404, { error: 'Not found' })
  } catch (error) {
    if (!error.statusCode) console.error(error)
    return json(response, error.statusCode || 500, { error: error.message })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`API listening on http://127.0.0.1:${port}`)
})

export { server }

if (process.argv[1] !== fileURLToPath(import.meta.url)) server.close()
