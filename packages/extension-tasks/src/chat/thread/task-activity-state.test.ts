import { describe, expect, it } from 'vite-plus/test'
import { activityCommandLabel, taskActivityState, taskActivityOutcome } from './task-activity-state'

describe('task activity state', () => {
  it('finishes active tools according to the parent turn outcome', () => {
    expect(taskActivityState('in_progress', 'running')).toBe('running')
    expect(taskActivityState('running', 'cancelled')).toBe('stopped')
    expect(taskActivityState('pending', 'failed')).toBe('failed')
    expect(taskActivityState('started', 'completed')).toBe('interrupted')
  })
  it('preserves independently reported completion, failure and cancellation', () => {
    expect(taskActivityState('completed', 'cancelled')).toBe('completed')
    expect(taskActivityState('error', 'completed')).toBe('failed')
    expect(taskActivityState('declined', 'completed')).toBe('stopped')
    expect(taskActivityState('interrupted', 'running')).toBe('interrupted')
    expect(taskActivityState('recorded', 'completed')).toBe('recorded')
  })
})

it('summarizes unfinished and failed actions without claiming success', () => {
  expect(taskActivityOutcome(['completed', 'failed', 'failed', 'stopped', 'interrupted'])).toBe(
    '2 failed · 1 stopped · 1 interrupted',
  )
  expect(taskActivityOutcome(['completed', 'running', 'recorded'])).toBe('')
})

describe('command activity labels', () => {
  it.each([
    ['rg --files packages', 'rg'],
    ['/usr/bin/git status --short', 'git'],
    ["/bin/zsh -lc 'cat package.json'", 'cat'],
    ['/bin/bash -l -c "rg tools"', 'rg'],
    ['env CI=1 NODE_OPTIONS="--foo bar" /usr/bin/node script.mjs', 'node'],
    ['"/path with spaces/node" script.mjs', 'node'],
    ['', 'command'],
  ])('extracts a readable executable from %s', (command, expected) => {
    expect(activityCommandLabel(command)).toBe(expected)
  })
})
