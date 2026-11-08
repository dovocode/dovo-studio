import { expect, it } from 'vite-plus/test'
import {
  decode,
  decodeResult,
  agentSchema,
  defaultTaskHarness,
  agentSecretReferencesSchema,
  secretReferenceIssue,
} from '../index.js'

it('round trips reference configuration while refusing reserved names, flags and incomplete provider scope', () => {
  const envSecrets = {
    API_KEY: {
      provider: 'infisical',
      reference: 'KEY',
      projectId: 'project',
      environment: 'production',
      path: '/backend',
      domain: 'https://secrets.example/api',
    },
  }
  const agent = decode(agentSchema, {
    ...defaultTaskHarness('codex'),
    id: 'agent',
    name: 'Agent',
    envSecrets,
  })
  expect(agent.envSecrets).toEqual(envSecrets)
  for (const refs of [
    { DOVO_OWNER_TOKEN: { provider: 'environment', reference: 'HOST_KEY' } },
    { KEY: { provider: 'environment', reference: 'dovo_owner_token' } },
    { KEY: { provider: 'bitwarden', reference: '--session=private' } },
    { KEY: { ...envSecrets.API_KEY, projectId: '' } },
    { KEY: { ...envSecrets.API_KEY, domain: 'https://user:private@secrets.example' } },
  ])
    expect(decodeResult(agentSecretReferencesSchema, refs).success).toBe(false)
  expect(secretReferenceIssue(agent.envSecrets)).toBe('')
})
