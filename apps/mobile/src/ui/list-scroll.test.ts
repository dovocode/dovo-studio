import { describe, expect, it } from 'vite-plus/test'
import { createListScroll } from './list-scroll'

describe('list scroll restoration', () => {
  it('retains a real drag position while native push/pop changes the hidden viewport', () => {
    const saved = { current: 0 },
      requests: number[] = []
    const scroll = createListScroll(saved, (offset) => requests.push(offset))
    scroll.viewport(650)
    scroll.content(1900)
    scroll.beginDrag()
    scroll.scroll(1250)
    scroll.retainPosition()
    scroll.viewport(750)
    scroll.scroll(1150)
    scroll.setFocused(false)
    scroll.scroll(1100)
    expect(saved.current).toBe(1250)
    scroll.setFocused(true)
    scroll.viewport(650)
    scroll.scroll(1250)
    expect(requests.at(-1)).toBe(1250)
    scroll.beginDrag()
    scroll.scroll(800)
    expect(saved.current).toBe(800)
  })

  it('captures current position on blur even without an explicit row press', () => {
    const saved = { current: 0 },
      requests: number[] = []
    const scroll = createListScroll(saved, (offset) => requests.push(offset))
    scroll.viewport(650)
    scroll.content(1900)
    scroll.beginDrag()
    scroll.scroll(1200)
    scroll.setFocused(false)
    scroll.viewport(850)
    scroll.scroll(1050)
    expect(saved.current).toBe(1200)
    scroll.viewport(650)
    scroll.setFocused(true)
    expect(requests).toEqual([1200])
  })
  it('keeps the saved offset while the initial render window clamps native scrolling', () => {
    const saved = { current: 1250 },
      requests: number[] = [],
      scroll = createListScroll(saved, (offset) => requests.push(offset))
    scroll.scroll(0)
    scroll.viewport(650)
    scroll.content(1100)
    scroll.scroll(450)
    expect(saved.current).toBe(1250)
    scroll.content(1900)
    scroll.scroll(1250)
    expect(requests).toEqual([450, 1250])
    expect(saved.current).toBe(1250)
    scroll.beginDrag()
    scroll.scroll(1170)
    expect(saved.current).toBe(1170)
  })

  it('waits for the measured tab-safe viewport without a timer', () => {
    const saved = { current: 1250 },
      requests: number[] = [],
      scroll = createListScroll(saved, (offset) => requests.push(offset))
    scroll.content(1900)
    expect(requests).toEqual([])
    scroll.viewport(750)
    scroll.scroll(1150)
    expect(saved.current).toBe(1250)
    scroll.viewport(650)
    scroll.scroll(1250)
    expect(requests).toEqual([1150, 1250])
  })

  it('preserves the original position through an intermediate host remount', () => {
    const saved = { current: 1250 }
    const temporary = createListScroll(saved, () => {})
    temporary.viewport(650)
    temporary.content(1100)
    temporary.scroll(450)
    const requests: number[] = []
    const returned = createListScroll(saved, (offset) => requests.push(offset))
    returned.viewport(650)
    returned.content(1900)
    expect(requests).toEqual([1250])
  })

  it('clamps shorter content without discarding intent when the tab inset changes', () => {
    const saved = { current: 1250 },
      requests: number[] = [],
      scroll = createListScroll(saved, (offset) => requests.push(offset))
    scroll.content(1900)
    scroll.viewport(750)
    scroll.scroll(1150)
    expect(saved.current).toBe(1250)
    scroll.viewport(650)
    scroll.scroll(1250)
    expect(requests).toEqual([1150, 1250])
    // A later layout pass may briefly expose the larger viewport again.
    scroll.viewport(750)
    scroll.scroll(1150)
    scroll.viewport(650)
    expect(requests).toEqual([1150, 1250, 1150, 1250])
    expect(saved.current).toBe(1250)
  })

  it('lands at a shorter list end and adopts that position once the user interacts', () => {
    const saved = { current: 1250 },
      requests: number[] = [],
      scroll = createListScroll(saved, (offset) => requests.push(offset))
    scroll.viewport(650)
    scroll.content(1000)
    scroll.scroll(350)
    expect(requests).toEqual([350])
    scroll.beginDrag()
    scroll.scroll(340)
    expect(saved.current).toBe(340)
  })

  it('gives an actual user drag precedence over an unfinished restoration', () => {
    const saved = { current: 1250 },
      requests: number[] = [],
      scroll = createListScroll(saved, (offset) => requests.push(offset))
    scroll.viewport(650)
    scroll.content(1100)
    scroll.beginDrag()
    scroll.scroll(100)
    scroll.content(1900)
    expect(saved.current).toBe(100)
    expect(requests).toEqual([450])
  })
})
