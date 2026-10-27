import { expect, it } from 'vite-plus/test'
import { createNotificationViewport, type Rectangle } from './viewport'
import { blockAccessibleNotificationInputs, shouldAlertForNotification } from './visibility'

it('alerts when scrolled away, and suppresses only cards fully visible after scrolling back', () => {
  const viewport = createNotificationViewport((callback) =>
    callback({ x: 0, y: 0, width: 300, height: 400 }),
  )
  const first = {
    runtimeId: 'host',
    taskId: 'thread',
    inputId: 'one',
    inputType: 'approval' as const,
  }
  const second = { ...first, inputId: 'two' }
  let firstRect = { x: 10, y: 40, width: 280, height: 150 }
  let secondRect = { x: 10, y: 220, width: 280, height: 150 }
  const removeFirst = viewport.observe(first, (callback) => callback(firstRect))
  const removeSecond = viewport.observe(second, (callback) => callback(secondRect))
  const alert = (input: typeof first) =>
    shouldAlertForNotification({ ...input, kind: 'input' }, true)
  expect(alert(first)).toBe(false)
  expect(alert(second)).toBe(false)
  firstRect = { ...firstRect, y: -120 }
  secondRect = { ...secondRect, y: 60 }
  viewport.refresh()
  expect(alert(first)).toBe(true)
  expect(alert(second)).toBe(false)
  const close = blockAccessibleNotificationInputs()
  expect(alert(second)).toBe(true)
  close()
  firstRect = { ...firstRect, y: 40 }
  secondRect = { ...secondRect, y: 370 }
  viewport.refresh()
  expect(alert(first)).toBe(false)
  expect(alert(second)).toBe(true)
  removeFirst()
  removeSecond()
})

it('rejects stale and missing measurements, including after unmount', () => {
  const callbacks: Array<(rectangle: Rectangle) => void> = []
  const viewport = createNotificationViewport((callback) => callbacks.push(callback))
  const input = {
    runtimeId: 'host',
    taskId: 'thread',
    inputId: 'question',
    inputType: 'question' as const,
  }
  const rect = { x: 0, y: 0, width: 100, height: 100 }
  let cardCallback: ((rectangle: Rectangle) => void) | undefined
  const remove = viewport.observe(input, (callback) => {
    cardCallback = callback
  })
  const alert = () => shouldAlertForNotification({ ...input, kind: 'input' }, true)
  expect(alert()).toBe(true)
  callbacks[0](rect)
  viewport.refresh()
  cardCallback?.(rect)
  expect(alert()).toBe(true)
  callbacks[1](rect)
  cardCallback?.(rect)
  expect(alert()).toBe(false)
  viewport.refresh()
  expect(alert()).toBe(true)
  callbacks[2](rect)
  remove()
  cardCallback?.(rect)
  expect(alert()).toBe(true)
})
