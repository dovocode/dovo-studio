import { expect, it } from 'vite-plus/test'
import {
  advanceTerminalTurn,
  closeWorkingTurns,
  initialTerminalTurnProgress,
} from './turn-state.js'

it('retains the most recent 128 identified completions and counts a new use after eviction', () => {
  let progress = initialTerminalTurnProgress()
  for (let i = 0; i < 129; i++) {
    const id = String(i)
    progress = advanceTerminalTurn(progress, 'osc', true, undefined, true, id).progress
    const ended = advanceTerminalTurn(progress, 'osc', false, undefined, true, id)
    expect(ended.count).toBe(1)
    progress = ended.progress
  }
  expect(progress.open).toEqual([])
  expect(progress.completed).toHaveLength(128)
  expect(progress.completed?.[0]).toBe('1')
  const replay = advanceTerminalTurn(progress, 'hook', true, 0, true, '1')
  expect(advanceTerminalTurn(replay.progress, 'hook', false, 1, true, '1').count).toBe(0)
  const fresh = advanceTerminalTurn(progress, 'hook', true, 0, true, '0')
  expect(advanceTerminalTurn(fresh.progress, 'hook', false, 1, true, '0').count).toBe(1)
})

it('preserves skipped hook counter increments and does not count resumed work again at exit', () => {
  let progress = initialTerminalTurnProgress()
  progress = advanceTerminalTurn(progress, 'osc', true, undefined, true, 'same').progress
  const first = advanceTerminalTurn(progress, 'osc', false, undefined, true, 'same')
  expect(first.count).toBe(1)
  const hook = advanceTerminalTurn(first.progress, 'hook', false, 4, true, 'same')
  expect(hook.count).toBe(3)
  const resumed = advanceTerminalTurn(hook.progress, 'hook', true, 4, true, 'same')
  expect(resumed.apply).toBe(true)
  expect(closeWorkingTurns(resumed.progress).count).toBe(0)
})

it('pairs an untagged end with the working peer and a later tagged completion', () => {
  let progress = initialTerminalTurnProgress()
  progress = advanceTerminalTurn(progress, 'osc', true, undefined, true, 'job').progress
  const ended = advanceTerminalTurn(progress, 'hook', false, 1, true)
  expect(ended.count).toBe(1)
  expect(ended.progress.open).toEqual([])
  expect(advanceTerminalTurn(ended.progress, 'osc', false, undefined, true, 'job').count).toBe(0)
})

it('keeps anonymous work visible when an older identified turn is replayed', () => {
  let progress = initialTerminalTurnProgress()
  progress = advanceTerminalTurn(progress, 'hook', true, 0, true, 'older').progress
  progress = advanceTerminalTurn(progress, 'hook', false, 1, true, 'older').progress
  progress = advanceTerminalTurn(progress, 'osc', true, undefined, true).progress
  const late = advanceTerminalTurn(progress, 'hook', false, 1, true, 'older')
  expect(late.apply).toBe(false)
  expect(late.count).toBe(0)
  expect(closeWorkingTurns(late.progress).count).toBe(1)
})
