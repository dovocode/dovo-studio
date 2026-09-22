import { describe, expect, it } from 'vite-plus/test'
import { createAutomationStarts } from './automation-starts'

describe('automation starts across native navigation', () => {
  it('retains the request after a lost response and a detail remount', () => {
    const starts = createAutomationStarts()
    const first = starts.begin('host', 'flow', () => 'first')
    expect(starts.get('host', 'flow')).toBe(first)
    expect(starts.begin('host', 'flow', () => 'duplicate')).toBe(first)
    starts.complete('host', 'flow', first)
    expect(starts.get('host', 'flow')).toBeUndefined()
    expect(starts.begin('host', 'flow', () => 'next')).toBe('next')
  })
  it('keeps colliding automation IDs on different computers separate', () => {
    const starts = createAutomationStarts()
    starts.begin('host-a', 'flow', () => 'a')
    starts.begin('host-b', 'flow', () => 'b')
    starts.begin('host-a', 'other', () => 'other')
    starts.complete('host-b', 'flow', 'b')
    expect(starts.get('host-a', 'flow')).toBe('a')
    expect(starts.get('host-a', 'other')).toBe('other')
  })
  it('does not let a late response clear a newer start attempt', () => {
    const starts = createAutomationStarts()
    starts.begin('host', 'flow', () => 'first')
    starts.complete('host', 'flow', 'first')
    starts.begin('host', 'flow', () => 'next')
    starts.complete('host', 'flow', 'first')
    expect(starts.get('host', 'flow')).toBe('next')
  })
})
