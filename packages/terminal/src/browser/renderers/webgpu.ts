/// <reference types="@webgpu/types" />
import type { TerminalRenderer } from '../render-types'
import { ATLAS_SIZE, GlyphAtlas, type AtlasPage } from './scene'

export async function createWebGPU(
  canvas: OffscreenCanvas,
  onLoss?: (error: Error) => void,
): Promise<TerminalRenderer> {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable')
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('WebGPU adapter is unavailable')
  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')
  if (!context) {
    device.destroy()
    throw new Error('WebGPU canvas context is unavailable')
  }
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque' })
  const shader = device.createShaderModule({
    code: `
    struct Output { @builtin(position) position: vec4f, @location(0) uv: vec2f }
    @vertex fn vertex(@location(0) position: vec2f, @location(1) uv: vec2f) -> Output {
      var out: Output; out.position = vec4f(position, 0, 1); out.uv = uv; return out;
    }
    @group(0) @binding(0) var atlas: texture_2d<f32>;
    @group(0) @binding(1) var atlasSampler: sampler;
    @fragment fn fragment(in: Output) -> @location(0) vec4f { return textureSample(atlas, atlasSampler, in.uv); }
  `,
  })
  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  })
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bindLayout] })
  const makePipeline = (blend: boolean) =>
    device.createRenderPipeline({
      layout,
      vertex: {
        module: shader,
        entryPoint: 'vertex',
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 8, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: shader,
        entryPoint: 'fragment',
        targets: [
          {
            format,
            blend: blend
              ? {
                  color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
                  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                }
              : undefined,
          },
        ],
      },
      primitive: { topology: 'triangle-list' },
    })
  const opaquePipeline = makePipeline(false)
  const blendedPipeline = makePipeline(true)
  const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' })
  const atlas = new GlyphAtlas()
  const textures = new Map<AtlasPage, { texture: GPUTexture; bind: GPUBindGroup }>()
  let vertexBuffer: GPUBuffer | undefined
  let bufferCapacity = 0
  let disposed = false,
    loss: Error | undefined
  const reportLoss = (error: Error) => {
    if (disposed || loss) return
    loss = error
    onLoss?.(error)
  }
  const uncaptured = (event: GPUUncapturedErrorEvent) =>
    reportLoss(new Error(`Terminal WebGPU error: ${event.error.message}`))
  device.addEventListener('uncapturederror', uncaptured)
  void device.lost.then((info) =>
    reportLoss(new Error(`Terminal WebGPU device lost: ${info.message || info.reason}`)),
  )
  return {
    kind: 'webgpu',
    resize(width, height) {
      canvas.width = width
      canvas.height = height
    },
    render(frame, options) {
      if (loss) throw loss
      if (!canvas.width || !canvas.height) return
      const scene = atlas.scene(frame, options, canvas.width, canvas.height)
      for (const [page, resource] of textures)
        if (!atlas.pages.includes(page)) {
          resource.texture.destroy()
          textures.delete(page)
        }
      for (const page of atlas.pages) {
        let resource = textures.get(page)
        if (!resource) {
          const texture = device.createTexture({
            size: [ATLAS_SIZE, ATLAS_SIZE],
            format: 'rgba8unorm',
            usage:
              GPUTextureUsage.TEXTURE_BINDING |
              GPUTextureUsage.COPY_DST |
              GPUTextureUsage.RENDER_ATTACHMENT,
          })
          resource = {
            texture,
            bind: device.createBindGroup({
              layout: bindLayout,
              entries: [
                { binding: 0, resource: texture.createView() },
                { binding: 1, resource: sampler },
              ],
            }),
          }
          textures.set(page, resource)
        }
        if (page.dirty) {
          const { x, y, width, height } = page.dirty
          device.queue.copyExternalImageToTexture(
            { source: page.canvas, origin: [x, y] },
            { texture: resource.texture, origin: [x, y] },
            [width, height],
          )
          page.dirty = undefined
        }
      }
      const vertices = scene.vertices
      if (!vertexBuffer || vertices.byteLength > bufferCapacity) {
        vertexBuffer?.destroy()
        bufferCapacity = Math.max(vertices.byteLength, bufferCapacity * 2, 4096)
        vertexBuffer = device.createBuffer({
          size: bufferCapacity,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        })
      }
      if (vertices.byteLength) device.queue.writeBuffer(vertexBuffer, 0, vertices)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: scene.background,
          },
        ],
      })
      pass.setVertexBuffer(0, vertexBuffer)
      let opaque: boolean | undefined
      for (const batch of scene.batches) {
        const resource = textures.get(batch.page)
        if (!resource) throw new Error('Missing WebGPU atlas texture')
        pass.setBindGroup(0, resource.bind)
        if (opaque !== batch.opaque) {
          opaque = batch.opaque
          pass.setPipeline(opaque ? opaquePipeline : blendedPipeline)
        }
        pass.draw(batch.count, 1, batch.offset)
      }
      pass.end()
      device.queue.submit([encoder.finish()])
    },
    dispose() {
      disposed = true
      device.removeEventListener('uncapturederror', uncaptured)
      vertexBuffer?.destroy()
      for (const resource of textures.values()) resource.texture.destroy()
      textures.clear()
      atlas.reset()
      context.unconfigure()
      device.destroy()
    },
  }
}
