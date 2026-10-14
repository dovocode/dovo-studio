import { expect, it } from 'vite-plus/test'
import { decode } from '../../shared/schema.js'
import { workspaceSchema } from '../../workspace.js'
import {
  projectWorkspaceEdits,
  workspaceDraftConsumed,
  reconcileWorkspaceEdit,
} from './workspace-reconciliation'
it('merges independent nested leaves and keeps the runtime on competing leaves', () => {
  expect(
    reconcileWorkspaceEdit(
      { config: { a: 1, b: 1 }, name: 'old' },
      { config: { a: 2, b: 1 }, name: 'local' },
      { config: { a: 1, b: 2 }, name: 'runtime' },
    ),
  ).toEqual({ value: { config: { a: 2, b: 2 }, name: 'runtime' }, conflicted: true })
})
it('keeps deletions, retries and unchanged local values safe', () => {
  expect(reconcileWorkspaceEdit({ a: 1, b: 1 }, { b: 1 }, { a: 1, b: 2 })).toEqual({
    value: { b: 2 },
    conflicted: false,
  })
  expect(reconcileWorkspaceEdit('old', 'new', 'new')).toEqual({ value: 'new', conflicted: false })
  expect(reconcileWorkspaceEdit('old', 'old', 'new')).toEqual({ value: 'new', conflicted: false })
})
it('does not guess at competing array ordering', () => {
  expect(reconcileWorkspaceEdit([1], [1, 2], [1, 3])).toEqual({ value: [1, 3], conflicted: true })
})
it('merges own properties without consulting object prototypes', () => {
  const before = JSON.parse('{"constructor":1,"__proto__":{"a":1,"b":1}}')
  const local = JSON.parse('{"constructor":2,"__proto__":{"a":2,"b":1}}')
  const host = JSON.parse('{"constructor":1,"__proto__":{"a":1,"b":2}}')
  expect(reconcileWorkspaceEdit(before, local, host)).toEqual({
    value: JSON.parse('{"constructor":2,"__proto__":{"a":2,"b":2}}'),
    conflicted: false,
  })
  expect(Object.getPrototypeOf(reconcileWorkspaceEdit(before, local, host).value)).toBe(
    Object.prototype,
  )
})

it('projects safe pending fields without hiding runtime conflicts or recreating deleted entities', () => {
  const host = decode(workspaceSchema, {
    version: 1,
    runtimeAddress: '',
    agents: [
      {
        id: 'agent',
        name: 'Runtime name',
        instructions: '',
        provider: 'codex',
        model: '',
        permission: 'ask',
        endpoint: '',
      },
    ],
    repositories: [],
    tasks: [],
    automations: [],
  })
  const projected = projectWorkspaceEdits(host, [
    {
      collection: 'agents',
      id: 'agent',
      changes: {
        name: { before: 'Before', after: 'Local name' },
        instructions: { before: '', after: 'Local instructions' },
      },
    },
    {
      collection: 'agents',
      id: 'deleted',
      changes: { name: { before: 'Before', after: 'Resurrected' } },
    },
  ])
  expect(projected.agents[0]?.name).toBe('Runtime name')
  expect(projected.agents[0]?.instructions).toBe('Local instructions')
  expect(projected.agents).toHaveLength(1)
  expect(projected.repositories).toBe(host.repositories)
  expect(host.agents[0]?.instructions).toBe('')
  expect(
    projectWorkspaceEdits(host, [
      { collection: 'agents', id: 'agent', changes: { provider: { before: 'codex', after: 123 } } },
    ]),
  ).toBe(host)
})

it('retains the next draft when the runtime consumed the previous one', () => {
  expect(
    workspaceDraftConsumed({ draft: '', history: { latestUserText: 'Sent draft' } }, 'Sent draft'),
  ).toBe(true)
  expect(
    workspaceDraftConsumed(
      { draft: '', history: { latestUserText: 'Other message' } },
      'Sent draft',
    ),
  ).toBe(false)
})
