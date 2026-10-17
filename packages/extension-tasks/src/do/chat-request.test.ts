import { expect, it } from 'vite-plus/test'
import { decodeResult, doChatCreateRequestSchema } from '@dovo/protocol'
import { doChatRequest } from './chat-request'

it('reuses the create request after a lost reply so retry cannot create a second chat', () => {
  const input = { text: 'Help me improve the onboarding flow.' }
  const first = doChatRequest(null, input)
  expect(decodeResult(doChatCreateRequestSchema, first).success).toBe(true)
  expect(first).not.toHaveProperty('repositoryId')
  expect(first).not.toHaveProperty('agentId')
  expect(doChatRequest(first, { ...input })).toBe(first)
})

it('uses a new request identity when the message or coordinating context changes', () => {
  const first = doChatRequest(null, {
    text: 'Review onboarding',
    repositoryId: 'website',
    agentId: 'configured-agent',
  })
  for (const input of [
    { text: 'Review checkout', repositoryId: 'website', agentId: 'configured-agent' },
    { text: first.text, repositoryId: 'mobile', agentId: 'configured-agent' },
    { text: first.text, repositoryId: 'website', agentId: 'another-agent' },
    { text: first.text },
  ]) {
    const next = doChatRequest(first, input)
    expect(next.id).not.toBe(first.id)
    expect(decodeResult(doChatCreateRequestSchema, next).success).toBe(true)
  }
})
