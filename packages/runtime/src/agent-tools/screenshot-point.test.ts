import { expect, it } from 'vite-plus/test'
import { screenshotPoint } from './screenshot-point.js'

function screenshot(width: number, height: number) {
  const png = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  return `data:image/png;base64,${png.toString('base64')}`
}

it('maps full-resolution portrait and landscape screenshots to iOS points', () => {
  const screen = { width: 393, height: 852 }
  expect(screenshotPoint(screenshot(1179, 2556), screen, 600, 1200)).toEqual({ x: 200, y: 400 })
  expect(screenshotPoint(screenshot(2556, 1179), screen, 1200, 600)).toEqual({ x: 400, y: 200 })
  expect(screenshotPoint(screenshot(786, 1704), screen, 400, 800)).toEqual({ x: 200, y: 400 })
})
