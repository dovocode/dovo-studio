import { describe, expect, it } from 'vite-plus/test'
import { fullSwipe, swipeTarget, swipeTranslation } from './task-swipe-motion'

describe('thread swiping', () => {
  it('follows the finger, then resists overswiping without leaving a blank gap', () => {
    expect(swipeTranslation(-60, 160, 320)).toBe(-60)
    expect(swipeTranslation(-200, 160, 320)).toBe(-186)
    expect(swipeTranslation(-1000, 160, 320)).toBe(-320)
    expect(swipeTranslation(40, 160, 320)).toBe(0)
  })
  it('settles by distance for slow gestures and by direction for flicks', () => {
    expect(swipeTarget(-60, 0, 160)).toBe(0)
    expect(swipeTarget(-100, 0, 160)).toBe(-160)
    expect(swipeTarget(-20, -700, 160)).toBe(-160)
    expect(swipeTarget(-150, 700, 160)).toBe(0)
    expect(swipeTarget(-50, 0, 80)).toBe(-80)
  })
  it('requires a deliberate full swipe and lets the user back out before releasing', () => {
    expect(fullSwipe(-160, -700, 320, 160)).toBe(false)
    expect(fullSwipe(-240, -100, 320, 160)).toBe(true)
    expect(fullSwipe(-240, 100, 320, 160)).toBe(false)
    expect(fullSwipe(-200, 0, 320, 160)).toBe(false)
    expect(fullSwipe(-240, 0, 600, 160)).toBe(false)
    expect(fullSwipe(-440, 0, 600, 160)).toBe(true)
  })
})
