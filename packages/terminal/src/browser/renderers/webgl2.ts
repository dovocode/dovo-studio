import type { TerminalRenderer } from '../render-types'
import { ATLAS_SIZE, GlyphAtlas, type AtlasPage } from './scene'

export function createWebGL2(
  canvas: OffscreenCanvas,
  onLoss?: (error: Error) => void,
): TerminalRenderer {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false })
  if (!gl) throw new Error('WebGL2 is unavailable')
  function shader(type: number, source: string): WebGLShader {
    const result = gl!.createShader(type)
    if (!result) throw new Error('Unable to create WebGL shader')
    gl!.shaderSource(result, source)
    gl!.compileShader(result)
    if (!gl!.getShaderParameter(result, gl!.COMPILE_STATUS))
      throw new Error(gl!.getShaderInfoLog(result) ?? 'WebGL shader compilation failed')
    return result
  }
  const vertex = shader(
    gl.VERTEX_SHADER,
    '#version 300 es\nin vec2 position; in vec2 uv; out vec2 texcoord; void main(){gl_Position=vec4(position,0,1);texcoord=uv;}',
  )
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    '#version 300 es\nprecision highp float; in vec2 texcoord; uniform sampler2D atlas; out vec4 color; void main(){color=texture(atlas,texcoord);}',
  )
  const program = gl.createProgram(),
    buffer = gl.createBuffer(),
    vao = gl.createVertexArray()
  if (!program || !buffer || !vao) throw new Error('Unable to create WebGL terminal resources')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL program linking failed')
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  for (const [name, offset] of [
    ['position', 0],
    ['uv', 8],
  ] as const) {
    const location = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset)
  }
  const atlas = new GlyphAtlas()
  const textures = new Map<AtlasPage, WebGLTexture>()
  const scratch = new OffscreenCanvas(1, 1)
  const scratchContext = scratch.getContext('2d')
  if (!scratchContext) throw new Error('Unable to create atlas upload canvas')
  let bufferCapacity = 0
  function syncTextures(): void {
    for (const [page, texture] of textures)
      if (!atlas.pages.includes(page)) {
        gl!.deleteTexture(texture)
        textures.delete(page)
      }
    for (const page of atlas.pages) {
      let texture = textures.get(page)
      if (!texture) {
        texture = gl!.createTexture() ?? undefined
        if (!texture) throw new Error('Unable to create WebGL atlas texture')
        textures.set(page, texture)
        gl!.bindTexture(gl!.TEXTURE_2D, texture)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
        gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
        gl!.texImage2D(
          gl!.TEXTURE_2D,
          0,
          gl!.RGBA,
          ATLAS_SIZE,
          ATLAS_SIZE,
          0,
          gl!.RGBA,
          gl!.UNSIGNED_BYTE,
          null,
        )
      }
      if (page.dirty) {
        const { x, y, width, height } = page.dirty
        // Grow the staging backing only when needed; resizing on every dirty
        // rectangle reallocates its bitmap even when its dimensions repeat.
        if (scratch.width < width) scratch.width = width
        if (scratch.height < height) scratch.height = height
        scratchContext!.clearRect(0, 0, width, height)
        scratchContext!.drawImage(page.canvas, x, y, width, height, 0, 0, width, height)
        gl!.bindTexture(gl!.TEXTURE_2D, texture)
        gl!.texSubImage2D(
          gl!.TEXTURE_2D,
          0,
          x,
          y,
          width,
          height,
          gl!.RGBA,
          gl!.UNSIGNED_BYTE,
          scratch,
        )
        page.dirty = undefined
      }
    }
  }
  let isLost = false
  const lost = () => {
    isLost = true
    onLoss?.(new Error('Terminal WebGL2 context lost'))
  }
  canvas.addEventListener('webglcontextlost', lost)
  return {
    kind: 'webgl2',
    resize(width, height) {
      canvas.width = width
      canvas.height = height
    },
    render(frame, options) {
      if (isLost || gl.isContextLost()) throw new Error('Terminal WebGL2 context lost')
      if (!canvas.width || !canvas.height) return
      const scene = atlas.scene(frame, options, canvas.width, canvas.height)
      syncTextures()
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(program)
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.disable(gl.BLEND)
      gl.clearColor(...scene.background)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
      const vertices = scene.vertices
      if (vertices.byteLength > bufferCapacity) {
        bufferCapacity = Math.max(vertices.byteLength, bufferCapacity * 2, 4096)
        gl.bufferData(gl.ARRAY_BUFFER, bufferCapacity, gl.DYNAMIC_DRAW)
      }
      if (vertices.byteLength) gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices)
      let blending = false
      for (const batch of scene.batches) {
        const texture = textures.get(batch.page)
        if (!texture) throw new Error('Missing WebGL atlas texture')
        gl.bindTexture(gl.TEXTURE_2D, texture)
        if (blending === batch.opaque) {
          blending = !batch.opaque
          if (blending) gl.enable(gl.BLEND)
          else gl.disable(gl.BLEND)
        }
        gl.drawArrays(gl.TRIANGLES, batch.offset, batch.count)
      }
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', lost)
      gl.deleteVertexArray(vao)
      gl.deleteBuffer(buffer)
      for (const texture of textures.values()) gl.deleteTexture(texture)
      textures.clear()
      atlas.reset()
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    },
  }
}
