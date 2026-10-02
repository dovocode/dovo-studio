import { expect, it } from 'vite-plus/test'
import { pullStacks, pullHeadBranch, pullStackLabel, updatePullStackPrompt } from './pull-stack.js'
import type { PullSummary } from './pulls.js'
const pull = (
  number: number,
  head: string,
  base: string,
  changes: Partial<PullSummary> = {},
): PullSummary => ({
  number,
  head,
  base,
  title: `PR ${number}`,
  url: `https://github.com/acme/repo/pull/${number}`,
  state: 'open',
  draft: false,
  author: 'dev',
  updatedAt: '2026-10-02',
  labels: [],
  ...changes,
})
it('orders linear and branching stacks parent-first and records direct dependencies', () => {
  const stacks = pullStacks([
    pull(3, 'third', 'second'),
    pull(4, 'sibling', 'first'),
    pull(1, 'first', 'main'),
    pull(2, 'second', 'first'),
  ])
  expect(stacks.get(3)).toMatchObject({
    rootNumber: 1,
    position: 3,
    size: 4,
    parentNumber: 2,
    complete: true,
  })
  expect(
    stacks.get(1)?.members.map((member) => [member.number, member.parentNumber, member.depth]),
  ).toEqual([
    [1, undefined, 0],
    [2, 1, 1],
    [3, 2, 2],
    [4, 1, 1],
  ])
  expect(pullStackLabel(stacks.get(3)!)).toBe('Stack 3/4')
  expect(
    pullStackLabel(
      pullStacks([pull(1, 'first', 'main'), pull(2, 'second', 'first')], false).get(2)!,
    ),
  ).toBe('Stack · partial')
})
it('rejects ambiguous parents, cycles, unrelated links, closed parents and fork-name collisions', () => {
  expect(
    pullStacks([
      pull(1, 'feature', 'main'),
      pull(2, 'feature', 'main'),
      pull(3, 'child', 'feature'),
    ]).size,
  ).toBe(0)
  expect(
    pullStacks([pull(1, 'one', 'two'), pull(2, 'two', 'one'), pull(3, 'three', 'two')]).size,
  ).toBe(0)
  expect(
    pullStacks([pull(1, 'one', 'main', { state: 'merged' }), pull(2, 'two', 'one')]).size,
  ).toBe(0)
  expect(pullStacks([pull(1, 'fork:one', 'acme:main'), pull(2, 'acme:two', 'acme:one')]).size).toBe(
    0,
  )
  expect(
    pullStacks([
      pull(1, 'one', 'main'),
      pull(2, 'two', 'one'),
      pull(1, 'other', 'main', { url: 'https://github.com/other/repo/pull/1' }),
    ]).size,
  ).toBe(0)
  expect(
    pullStacks([
      pull(1, 'one', 'main', { url: 'https://github.com/other/repo/pull/1' }),
      pull(2, 'two', 'one'),
    ]).size,
  ).toBe(0)
})
it('updates dependencies after retargeting and normalizes only valid same-project parent refs', () => {
  expect(pullStacks([pull(1, 'one', 'main'), pull(2, 'two', 'main')]).size).toBe(0)
  expect(pullHeadBranch(pull(1, 'acme:feature', 'acme:main'))).toBe('feature')
  expect(pullHeadBranch(pull(1, 'fork:feature', 'acme:main'))).toBeNull()
  expect(pullHeadBranch(pull(1, 'feature', 'main'))).toBe('feature')
  const stack = pullStacks([pull(1, 'one', 'main'), pull(2, 'two', 'one')]).get(2)!
  expect(updatePullStackPrompt(stack)).toContain('--force-with-lease=<ref>:<expected-tip>')
  expect(updatePullStackPrompt(stack)).toContain('Do not merge or close any PR')
})
