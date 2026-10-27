import { describe, expect, it, vi } from 'vite-plus/test'
import { dispatchKeyboardSearch, registerKeyboardSearch } from './keyboard-search'

describe('hardware search registration', () => {
  it('only dispatches to the most recently registered visible search', () => {
    const first = vi.fn<() => void>()
    const second = vi.fn<() => void>()
    expect(dispatchKeyboardSearch()).toBe(false)
    const removeFirst = registerKeyboardSearch(first)
    const removeSecond = registerKeyboardSearch(second)
    expect(dispatchKeyboardSearch()).toBe(true)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    removeSecond()
    expect(dispatchKeyboardSearch()).toBe(true)
    expect(first).toHaveBeenCalledOnce()
    removeFirst()
    expect(dispatchKeyboardSearch()).toBe(false)
  })
})
