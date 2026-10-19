import { expect, it } from 'vite-plus/test'
import { projectSubagentList, type Subagent } from './subagents.js'

const agent: Subagent = {
  id: 'child',
  taskId: 'child',
  source: 'dovo',
  provider: 'codex',
  name: 'Child',
  status: 'working',
  startedAt: '',
  updatedAt: '',
  tokens: 10,
  activity: 'Reading files',
}
it('keeps pill data stable when transcripts, timestamps and completion metadata change', () => {
  const previous = projectSubagentList([agent])
  const updated: Subagent = {
    ...agent,
    prompt: 'Large prompt '.repeat(10000),
    result: 'Large result '.repeat(10000),
    updatedAt: 'later',
    completion: 'read',
  }
  const next = projectSubagentList([updated], previous)
  expect(next).toBe(previous)
  expect(next[0]).not.toHaveProperty('prompt')
  expect(next[0]).not.toHaveProperty('result')
})
it('refreshes visible facts, order, membership and navigation targets', () => {
  const previous = projectSubagentList([agent])
  for (const change of [
    { tokens: 20 },
    { activity: 'Testing' },
    { taskId: 'new-target' },
    { name: 'Renamed' },
    { model: 'model' },
    { reasoning: 'high' },
    { provider: 'muse' },
  ]) {
    const next = projectSubagentList([{ ...agent, ...change }], previous)
    expect(next).not.toBe(previous)
    expect(next[0]).toMatchObject(change)
  }
  expect(projectSubagentList([], previous)).toEqual([])
  const other = { ...agent, id: 'other' }
  const ordered = projectSubagentList([agent, other])
  expect(projectSubagentList([other, agent], ordered).map((item) => item.id)).toEqual([
    'other',
    'child',
  ])
})

it('retains provider status without retaining transcript data', async () => {
  const { subagentListStatus } = await import('./subagents.js')
  const prior = projectSubagentList([agent])
  const next = projectSubagentList([{ ...agent, status: 'unknown' }], prior)
  expect(next).not.toBe(prior)
  expect(subagentListStatus(next[0]!, true)).toBe('Status unavailable')
  expect(subagentListStatus(prior[0]!, false)).toBe('Last seen working')
})
