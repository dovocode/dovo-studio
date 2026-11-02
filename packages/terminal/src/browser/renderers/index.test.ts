import { expect, it, vi } from 'vite-plus/test'
import type { TerminalRenderer } from '../render-types'
import { createTerminalRenderer, RendererInitializationError } from './index'

const webgl = vi.hoisted(() => vi.fn<() => TerminalRenderer>())
vi.mock('./webgl2', () => ({ createWebGL2: webgl }))

it('reports the attempted backend when target initialization fails after preflight', async () => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(_width: number, _height: number) {}
    },
  )
  const dispose = vi.fn<() => void>()
  webgl
    .mockReset()
    .mockReturnValueOnce({ kind: 'webgl2', dispose, resize() {}, render() {} })
    .mockImplementationOnce(() => {
      throw new Error('target failed')
    })
  const onLoss = vi.fn<(error: Error) => void>()
  const canvas = new OffscreenCanvas(10, 10)
  await expect(createTerminalRenderer(canvas, 'webgl2', onLoss)).rejects.toMatchObject({
    renderer: 'webgl2',
    message: expect.stringContaining('target failed'),
  })
  expect(dispose).toHaveBeenCalledOnce()
  expect(onLoss).toHaveBeenCalledOnce()
  const error = onLoss.mock.calls[0][0]
  expect(error).toBeInstanceOf(RendererInitializationError)
  expect(error instanceof RendererInitializationError && error.renderer).toBe('webgl2')
  vi.unstubAllGlobals()
})
