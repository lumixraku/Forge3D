import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAgentCanvas, projectDto, replaceCanvasDocument } from './projects.js'

const project = {
  id: 'canvas-1',
  name: 'Project name',
  description: 'Project description',
  revision: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ id: 'a-b' }],
  viewport: { x: 0, y: 0, zoom: 1 },
}

test('projects expose metadata and graph counts without graph data', () => {
  assert.deepEqual(projectDto(project), {
    id: 'canvas-1',
    name: 'Project name',
    description: 'Project description',
    revision: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    nodeCount: 2,
    edgeCount: 1,
  })
})

test('canvas replacement preserves project-owned metadata', () => {
  const replacement = replaceCanvasDocument(project, {
    id: 'wrong-id',
    name: 'Stale name',
    description: 'Stale description',
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
    revision: 99,
    nodes: [{ id: 'next' }],
    edges: [],
    viewport: { x: 10, y: 20, zoom: 2 },
  }, project.id, '2026-01-03T00:00:00.000Z')

  assert.equal(replacement.id, project.id)
  assert.equal(replacement.name, project.name)
  assert.equal(replacement.description, project.description)
  assert.equal(replacement.createdAt, project.createdAt)
  assert.equal(replacement.updatedAt, '2026-01-03T00:00:00.000Z')
  assert.equal(replacement.revision, 4)
  assert.deepEqual(replacement.nodes, [{ id: 'next' }])
})

test('agent canvas updates preserve project-owned metadata', () => {
  const replacement = applyAgentCanvas(project, {
    ...project,
    name: 'Agent name',
    description: 'Agent description',
    createdAt: '2000-01-01T00:00:00.000Z',
    nodes: [{ id: 'agent-node' }],
  })

  assert.equal(replacement.name, project.name)
  assert.equal(replacement.description, project.description)
  assert.equal(replacement.createdAt, project.createdAt)
  assert.deepEqual(replacement.nodes, [{ id: 'agent-node' }])
})
