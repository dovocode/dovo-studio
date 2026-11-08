import type { TerminalRenderer, TerminalRendererKind } from '../render-types'
import { createCanvas2D, type Canvas2DLifecycle } from './canvas2d'
import { createWebGL2 } from './webgl2'
import { createWebGPU } from './webgpu'

export class RendererInitializationError extends Error {
  constructor(
    readonly renderer: TerminalRendererKind,
    cause: unknown,
  ) {
    super(
      `Terminal ${renderer} initialization failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = 'RendererInitializationError'
  }
}

/** A lost context cannot be rebound; the owner must supply a fresh canvas. */
export async function createTerminalRenderer(
  canvas: OffscreenCanvas,
  preferred: TerminalRendererKind = 'webgpu',
  onLoss?: (error: Error) => void,
  canvas2dLifecycle?: Canvas2DLifecycle,
): Promise<TerminalRenderer> {
  const kinds: TerminalRendererKind[] = ['webgpu', 'webgl2', 'canvas2d']
  const failures: string[] = []
  for (const kind of kinds.slice(kinds.indexOf(preferred))) {
    try {
      const probe = new OffscreenCanvas(1, 1)
      const test =
        kind === 'webgpu'
          ? await createWebGPU(probe)
          : kind === 'webgl2'
            ? createWebGL2(probe)
            : createCanvas2D(probe)
      test.dispose()
    } catch (error) {
      failures.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    // Once a context is acquired on the target, a failure must be surfaced to
    // the owner, who can replace the canvas before trying another backend.
    try {
      return kind === 'webgpu'
        ? await createWebGPU(canvas, onLoss)
        : kind === 'webgl2'
          ? createWebGL2(canvas, onLoss)
          : createCanvas2D(canvas, canvas2dLifecycle)
    } catch (error) {
      // A failed initialization may already have bound the target canvas.
      // Canvas2D is the final backend, so reporting it as recoverable would
      // cause the owner to replace canvases indefinitely.
      const failure = new RendererInitializationError(kind, error)
      if (kind !== 'canvas2d') onLoss?.(failure)
      throw failure
    }
  }
  throw new Error(`No terminal renderer is available (${failures.join('; ')})`)
}
