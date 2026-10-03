import { providerConfiguration } from './agent-configuration'
import { expect, it } from 'vite-plus/test'
import {
  agentConnectionValue,
  changeAgentConnection,
  changeAgentProvider,
} from './agent-configuration'
import { defaultTaskHarness, type Agent } from '../workspace'

const agent: Agent = {
  ...defaultTaskHarness('opencode'),
  id: 'custom',
  name: 'Custom agent',
  endpoint: 'http://127.0.0.1:4096',
  executablePath: '/custom/opencode',
  configDirectory: '/accounts/opencode',
  model: 'old-model',
  reasoning: 'high',
  args: ['--old-provider'],
  instructions: 'Follow project conventions',
  env: { SHARED_SETTING: 'value' },
}

it('does not carry an old executable, account directory or model into a different provider', () => {
  const changed = changeAgentProvider(agent, 'claude')
  expect(changed).toMatchObject({
    id: agent.id,
    name: agent.name,
    provider: 'claude',
    endpoint: '',
    model: '',
    reasoning: '',
    args: [],
    instructions: agent.instructions,
    env: agent.env,
  })
  expect(changed.executablePath).toBeUndefined()
  expect(changed.configDirectory).toBeUndefined()
  expect(agent.endpoint).toBe('http://127.0.0.1:4096')
  expect(changeAgentProvider(agent, agent.provider)).toBe(agent)
})

it('clears installed ACP settings when changing provider', () => {
  const changed = changeAgentProvider(
    {
      ...agent,
      provider: 'acp',
      acpInstallationId: 'installed',
      acpMode: 'plan',
      acpConfig: { mode: 'old' },
    },
    'codex',
  )
  expect(changed.acpInstallationId).toBeUndefined()
  expect(changed.acpMode).toBeUndefined()
  expect(changed.acpConfig).toBeUndefined()
})

it('writes the displayed executable override for installed ACP and the endpoint for other agents', () => {
  const installed = { ...agent, provider: 'acp' as const, acpInstallationId: 'installed' }
  const changed = changeAgentConnection(installed, '/custom/acp')
  expect(changed.executablePath).toBe('/custom/acp')
  expect(changed.endpoint).toBe('')
  expect(changeAgentConnection(agent, 'http://localhost:5000').endpoint).toBe(
    'http://localhost:5000',
  )
  expect(changeAgentConnection(installed, '').executablePath).toBe('')
})

it('shows and replaces the executable actually used by the runtime, including legacy paths', () => {
  const codex = { ...agent, provider: 'codex' as const }
  expect(agentConnectionValue(codex)).toBe('/custom/opencode')
  const changed = changeAgentConnection(codex, '/custom/codex')
  expect(agentConnectionValue(changed)).toBe('/custom/codex')
  expect(changed.endpoint).toBe('')
  expect(agentConnectionValue(changeAgentConnection(codex, ''))).toBe('')
  expect(agentConnectionValue({ ...codex, executablePath: undefined })).toBe(codex.endpoint)
  expect(agentConnectionValue(agent)).toBe(agent.endpoint)
})

it('provider shortcuts never open a reviewer or another ACP installation', () => {
  const reviewer = { ...agent, name: 'Reviewer' }
  const normal = { ...agent, id: 'normal', name: '  OpenCode  ', endpoint: '' }
  const installation = { provider: 'opencode' as const, name: 'OpenCode' }
  expect(providerConfiguration([reviewer], installation)).toBeUndefined()
  expect(providerConfiguration([reviewer, normal], installation)).toBe(normal)
  const acp = { ...normal, provider: 'acp' as const, acpInstallationId: 'one' }
  expect(
    providerConfiguration([acp], { ...installation, provider: 'acp', installationId: 'two' }),
  ).toBeUndefined()
  expect(
    providerConfiguration([acp], { ...installation, provider: 'acp', installationId: 'one' }),
  ).toBe(acp)
})
