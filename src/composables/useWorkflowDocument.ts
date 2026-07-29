import { ref } from 'vue'
import { request } from '../api'
import { toCanvasGraph, toDomainWorkflow } from '../workflow-canvas'
import { importPlacementOffset, validateImportedWorkflow } from '../workflow-fragment'

// Owns the loaded workflow document: hydrating it onto the canvas, folding the
// canvas back into it, the debounced save queue, and the workflow library CRUD.
export function useWorkflowDocument({
  workflows,
  activeWorkflow,
  conversation,
  nodes,
  edges,
  run,
  nodeRuns,
  busy,
  error,
  saving,
  savedState,
  runToken,
  fitView,
  recordHistory,
  syncHistoryWorkflow,
  fitFramesAfterRender,
  restoreAgentTasks,
  pasteFragment,
  resetWorkspace,
  closeWorkflowSwitcher,
}) {
  const hydrating = ref(false)
  let saveTimer
  let savePromise = null
  let pendingSaveSnapshot = null

  async function toCanvas(workflow) {
    hydrating.value = true
    const graph = toCanvasGraph(workflow)
    nodes.value = graph.nodes
    edges.value = graph.edges
    // Repair workflows whose views were materialized before they were wired to the model node.
    await fitFramesAfterRender({ persist: true })
    hydrating.value = false
    syncHistoryWorkflow(workflow.id)
  }

  function fromCanvas() {
    return toDomainWorkflow(activeWorkflow.value, nodes.value, edges.value)
  }

  async function loadWorkflowList() {
    workflows.value = await request('/api/workflows')
  }

  async function loadWorkflows(preferredId?: string) {
    await loadWorkflowList()
    const id = preferredId || activeWorkflow.value?.id || workflows.value[0]?.id
    if (id) await openWorkflow(id)
  }

  async function openWorkflow(id) {
    resetWorkspace()
    if (activeWorkflow.value && activeWorkflow.value.id !== id) await flushPendingSave()
    runToken.value += 1
    error.value = ''
    const data = await request(`/api/workflows/${id}`)
    activeWorkflow.value = data.workflow
    conversation.value = data.conversation
    run.value = null
    nodeRuns.value = data.nodeRuns || {}
    await toCanvas(data.workflow)
    await restoreAgentTasks(id)
    fitView({ padding: 0.18, duration: 500 })
  }

  function scheduleSave() {
    if (!activeWorkflow.value || busy.value || hydrating.value) return
    recordHistory()
    savedState.value = 'Unsaved changes'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      saveWorkflow(fromCanvas())
    }, 700)
  }

  async function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      await saveWorkflow(fromCanvas())
    } else if (savePromise) {
      await savePromise
    }
  }

  async function saveWorkflow(workflow = fromCanvas()) {
    if (!workflow) return
    if (saving.value) {
      pendingSaveSnapshot = workflow
      return savePromise
    }
    saving.value = true
    savedState.value = 'Saving…'
    savePromise = (async () => {
      let nextWorkflow = workflow
      while (nextWorkflow) {
        const savingWorkflow = nextWorkflow
        pendingSaveSnapshot = null
        const savedWorkflow = await request(`/api/workflows/${savingWorkflow.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(savingWorkflow),
        })
        if (activeWorkflow.value?.id === savedWorkflow.id) activeWorkflow.value = savedWorkflow
        await loadWorkflowList()
        nextWorkflow = pendingSaveSnapshot
      }
    })()
    try {
      await savePromise
      savedState.value = 'Saved'
    } catch (caught) {
      error.value = caught.message
      savedState.value = 'Save failed'
    } finally {
      saving.value = false
      savePromise = null
    }
  }

  function stopPendingSave() {
    clearTimeout(saveTimer)
  }

  async function duplicateWorkflow(workflowId = activeWorkflow.value?.id) {
    if (!workflowId) return
    try {
      const workflow = await request(`/api/workflows/${workflowId}/duplicate`, { method: 'POST' })
      await loadWorkflows(workflow.id)
    } catch (caught) {
      error.value = caught.message
    }
  }

  async function deleteWorkflow(workflowId) {
    const workflow = workflows.value.find((item) => item.id === workflowId)
    if (!workflow || !window.confirm(`Delete "${workflow.name}"? This cannot be undone.`)) return

    try {
      const deletingActiveWorkflow = activeWorkflow.value?.id === workflowId
      if (deletingActiveWorkflow) await flushPendingSave()
      await request(`/api/workflows/${workflowId}`, { method: 'DELETE' })
      await loadWorkflowList()
      if (!deletingActiveWorkflow) return

      activeWorkflow.value = null
      conversation.value = null
      nodes.value = []
      edges.value = []
      run.value = null
      nodeRuns.value = {}
      if (workflows.value[0]) await openWorkflow(workflows.value[0].id)
    } catch (caught) {
      error.value = caught.message
    }
  }

  async function createWorkflow() {
    const name = window.prompt('Name this workflow', 'New 3D workflow')?.trim()
    if (!name) return

    try {
      const workflow = await request('/api/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: 'A new 3D production workflow ready to customize.',
          nodes: [],
          edges: [],
          viewport: { x: 80, y: 160, zoom: 0.72 },
        }),
      })
      await loadWorkflows(workflow.id)
    } catch (caught) {
      error.value = caught.message
    }
  }

  async function renameWorkflow(name) {
    activeWorkflow.value = { ...activeWorkflow.value, name }
    await saveWorkflow()
  }

  async function exportWorkflow(workflowId) {
    try {
      const { workflow } = await request(`/api/workflows/${workflowId}`)
      const blob = new Blob([`${JSON.stringify(workflow, null, 2)}\n`], { type: 'application/json' })
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(blob)
      anchor.download = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.workflow.json`
      anchor.click()
      URL.revokeObjectURL(anchor.href)
    } catch (caught) {
      error.value = `Workflow export failed: ${caught.message}`
    }
  }

  // An imported document is merged into the open workflow as a pasted fragment.
  async function importWorkflowFile(file) {
    if (!file) return

    try {
      const input = JSON.parse(await file.text())
      if (!activeWorkflow.value) throw new Error('Open a workflow before importing')
      validateImportedWorkflow(input)
      await pasteFragment(
        { nodes: input.nodes, edges: input.edges || [] },
        { offset: importPlacementOffset(nodes.value, input.nodes), translateRoots: true },
      )
      closeWorkflowSwitcher()
    } catch (caught) {
      error.value = `Workflow import failed: ${caught.message}`
    }
  }

  return {
    hydrating,
    toCanvas,
    fromCanvas,
    loadWorkflowList,
    loadWorkflows,
    openWorkflow,
    scheduleSave,
    flushPendingSave,
    saveWorkflow,
    stopPendingSave,
    duplicateWorkflow,
    deleteWorkflow,
    createWorkflow,
    renameWorkflow,
    exportWorkflow,
    importWorkflowFile,
  }
}
