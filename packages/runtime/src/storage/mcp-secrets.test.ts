import { expect, it } from 'vitest'
import { McpSecrets } from './mcp-secrets'
import { openDatabase } from './database'
import { WorkspaceStore } from './workspace'
import { redact } from './activity'

it('keeps literal MCP values private while allowing preservation, replacement and removal', () => {
  const secrets = new McpSecrets('test-key')
  const stored = {
    resources: {
      mcpServers: [
        {
          name: 'test',
          envValues: { API_KEY: 'private-value' },
          headerValues: { 'X-Key': 'another-secret' },
        },
      ],
    },
  }
  const visible = secrets.public(stored)
  expect(JSON.stringify(visible)).not.toContain('private-value')
  expect(JSON.stringify(visible)).not.toContain('another-secret')
  expect(secrets.restore(visible, stored)).toEqual(stored)
  expect(secrets.restore({ envValues: { API_KEY: 'replacement' } }, stored)).toEqual({
    envValues: { API_KEY: 'replacement' },
  })
  expect(secrets.restore({ envValues: {} }, stored)).toEqual({ envValues: {} })
  expect(() => secrets.restore(visible, {})).toThrow('Stored MCP value changed')
})

it('persists projection identity and preserves secrets through optimistic workspace edits', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.patch({
      collection: 'agents',
      id: 'agent',
      create: {
        id: 'agent',
        name: 'Agent',
        provider: 'codex',
        model: '',
        instructions: '',
        permission: 'ask',
        endpoint: '',
        resources: {
          mcpServers: [
            {
              name: 'test',
              enabled: true,
              transport: 'stdio',
              command: 'test',
              envValues: { OPENAI_API_KEY: 'private-key' },
            },
          ],
        },
      },
      changes: {},
    })
    const visible = store.publicWorkspace()
    expect(JSON.stringify(visible)).not.toContain('private-key')
    const before = visible.agents[0].resources
    store.patch({
      collection: 'agents',
      id: 'agent',
      changes: { resources: { before, after: { ...before, skills: [] } } },
    })
    expect(store.get().agents[0].resources?.mcpServers[0].envValues).toEqual({
      OPENAI_API_KEY: 'private-key',
    })
    const changed = {
      collection: 'agents' as const,
      id: 'agent',
      changes: { resources: { before, after: { ...before, mcpServers: [] } } },
    }
    store.patch(changed)
    expect(() => store.patch(changed)).not.toThrow()
    expect(new WorkspaceStore(db).publicWorkspace()).toEqual(store.publicWorkspace())
  } finally {
    db.close()
  }
})

it('redacts API key names and entire literal-value containers in activity', () => {
  const value = redact({
    OPENAI_API_KEY: 'one',
    'X-API-Key': 'two',
    envValues: { CUSTOM: 'three' },
    headerValues: { Custom: 'four' },
  })
  expect(value).toEqual({
    OPENAI_API_KEY: '[redacted]',
    'X-API-Key': '[redacted]',
    envValues: '[redacted]',
    headerValues: '[redacted]',
  })
})
