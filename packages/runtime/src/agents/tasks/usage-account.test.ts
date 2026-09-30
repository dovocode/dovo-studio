import { expect, it } from 'vitest'
import { reportedUsageAccount } from './usage-account'
it('uses provider identity without retaining credentials and separates workspaces', () => {
  const payload = {
    account: {
      type: 'chatgpt',
      email: 'person@example.com',
      planType: 'team',
      access_token: 'secret',
    },
    workspaceRouting: { chatgptAccountId: 'workspace-a' },
  }
  const first = reportedUsageAccount('codex', 'account/read', payload)
  expect(first).toMatchObject({ label: 'person@example.com', subscription: 'team' })
  expect(JSON.stringify(first)).not.toContain('secret')
  expect(
    reportedUsageAccount('codex', 'account/read', {
      ...payload,
      workspaceRouting: { chatgptAccountId: 'workspace-b' },
    })?.id,
  ).not.toBe(first?.id)
  expect(
    reportedUsageAccount('codex', 'account/read', { account: payload.account }),
  ).toBeUndefined()
  expect(
    reportedUsageAccount('codex', 'account/read', { account: { type: 'apiKey' } }),
  ).toBeUndefined()
})
it('groups Claude subscription readings by reported email and organization', () => {
  const account = {
    email: 'person@example.com',
    organization: 'org-a',
    subscriptionType: 'max',
    apiProvider: 'firstParty',
  }
  expect(reportedUsageAccount('claude', 'account/info', account)).toMatchObject({
    label: account.email,
    subscription: 'max',
  })
  expect(
    reportedUsageAccount('claude', 'account/info', { ...account, organization: 'org-b' })?.id,
  ).not.toBe(reportedUsageAccount('claude', 'account/info', account)?.id)
  expect(
    reportedUsageAccount('claude', 'account/info', { ...account, apiProvider: 'bedrock' }),
  ).toBeUndefined()
})
