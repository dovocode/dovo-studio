import { expect, it, vi } from 'vite-plus/test'
import { createTerminalViewers } from './viewers'

const setup = () => {
  const apply = vi.fn<(terminalId: string, size: { cols: number; rows: number }) => void>()
  return { apply, viewers: createTerminalViewers(apply) }
}

it('keeps every resize from a lone viewer, including repeats', () => {
  const { apply, viewers } = setup()
  const only = viewers.join('t')
  only.resize(80, 24)
  only.resize(80, 24)
  expect(apply).toHaveBeenCalledTimes(2)
})

it('isolates terminals and ignores a viewer after it leaves', () => {
  const { apply, viewers } = setup()
  const first = viewers.join('a'),
    other = viewers.join('b')
  other.resize(90, 30)
  expect(apply).toHaveBeenLastCalledWith('b', { cols: 90, rows: 30 })
  const watcher = viewers.join('a')
  watcher.resize(40, 20)
  expect(apply).toHaveBeenCalledOnce()
  watcher.leave()
  watcher.input()
  watcher.resize(41, 21)
  first.resize(100, 30)
  expect(apply).toHaveBeenLastCalledWith('a', { cols: 100, rows: 30 })
  expect(apply).toHaveBeenCalledTimes(2)
})

it('hands control to the most recently active viewer and skips a viewer without a size', () => {
  const { apply, viewers } = setup()
  const desktop = viewers.join('t'),
    phone = viewers.join('t'),
    tablet = viewers.join('t')
  desktop.resize(120, 40)
  phone.resize(50, 30)
  phone.input()
  expect(apply).toHaveBeenLastCalledWith('t', { cols: 50, rows: 30 })
  desktop.input()
  expect(apply).toHaveBeenLastCalledWith('t', { cols: 120, rows: 40 })
  // The phone typed after the tablet joined, so it is the most recent remaining viewer.
  desktop.leave()
  expect(apply).toHaveBeenLastCalledWith('t', { cols: 50, rows: 30 })
  expect(apply).toHaveBeenCalledTimes(4)
  // The tablet has no size yet, so the grid stays until it sends one.
  phone.leave()
  expect(apply).toHaveBeenCalledTimes(4)
  tablet.resize(70, 20)
  expect(apply).toHaveBeenLastCalledWith('t', { cols: 70, rows: 20 })
})

it('changes nothing when an observer leaves', () => {
  const { apply, viewers } = setup()
  const desktop = viewers.join('t'),
    phone = viewers.join('t')
  desktop.resize(120, 40)
  phone.resize(50, 30)
  phone.leave()
  expect(apply).toHaveBeenCalledOnce()
  desktop.resize(100, 30)
  expect(apply).toHaveBeenLastCalledWith('t', { cols: 100, rows: 30 })
})

it('does not resize again when the next viewer already matches the grid', () => {
  const { apply, viewers } = setup()
  const desktop = viewers.join('t'),
    phone = viewers.join('t')
  desktop.resize(80, 24)
  phone.resize(80, 24)
  phone.input()
  desktop.input()
  expect(apply).toHaveBeenCalledOnce()
  desktop.leave()
  phone.leave()
  // A new lone viewer starts fresh.
  viewers.join('t').resize(80, 24)
  expect(apply).toHaveBeenCalledTimes(2)
})
