'use client'

import { useEffect, useRef, useState } from 'react'

type Vec3 = readonly [number, number, number]
type Node = { position: Vec3; color: Vec3; size: number }
type Props = {
  stage: number
  running: boolean
  reduced: boolean
  onReady: (ready: boolean) => void
}
const counts = [1, 4, 16, 64, 256]
const colors: readonly Vec3[] = [
  [0.48, 0.79, 1],
  [0.4, 0.91, 0.91],
  [0.65, 0.71, 1],
  [0.72, 0.87, 1],
]
const centers: readonly Vec3[] = [
  [-0.5, 0.31, 0],
  [0.5, 0.31, 0.08],
  [-0.5, -0.35, 0.05],
  [0.5, -0.35, -0.05],
]

function constellation(stage: number): Node[] {
  const perGroup = stage === 0 ? 1 : counts[stage] / 4
  return Array.from({ length: counts[stage] }, (_, index) => {
    if (stage === 0) return { position: [0, 0, 0], color: colors[0], size: 19 }
    const group = Math.floor(index / perGroup)
    const local = index % perGroup
    const center = centers[group]
    const angle = local * 2.399963
    const radius = local === 0 ? 0 : Math.sqrt(local / perGroup) * (stage === 4 ? 0.28 : 0.2)
    return {
      position: [
        center[0] + Math.cos(angle) * radius,
        center[1] + Math.sin(angle) * radius * 0.8,
        center[2] + Math.sin(local * 1.7) * radius * 0.55,
      ],
      color: colors[group],
      size: local === 0 ? 16 : local % 4 === 0 ? 8 : stage === 4 ? 4.5 : 8,
    }
  })
}

const vertex = `
attribute vec3 aPosition;
attribute vec3 aColor;
attribute float aSize;
uniform float uAspect;
uniform float uDpr;
uniform vec2 uTilt;
varying vec3 vColor;
void main() {
  vec3 p = aPosition;
  float cy = cos(uTilt.x), sy = sin(uTilt.x);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  float cx = cos(uTilt.y), sx = sin(uTilt.y);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  float perspective = 1.0 / (1.0 + p.z * .32);
  float scale = uAspect * 1.12;
  gl_Position = vec4(p.x * scale / uAspect * perspective, p.y * .96 * perspective, 0.0, 1.0);
  gl_PointSize = aSize * uDpr * perspective;
  vColor = aColor;
}`
const fragment = `
precision mediump float;
uniform float uPoints;
varying vec3 vColor;
void main() {
  if (uPoints < .5) { gl_FragColor = vec4(vColor, .6); return; }
  float distance = length(gl_PointCoord - .5) * 2.0;
  float halo = exp(-distance * distance * 5.0);
  float core = exp(-distance * distance * 48.0);
  float alpha = (halo * .65 + core) * smoothstep(1.0, .75, distance);
  gl_FragColor = vec4(vColor + core * .55, alpha);
}`

/** Small GPU scene, no external assets. The HTML/SVG diagram remains the fallback. */
export function FleetWebGL({ stage, running, reduced, onReady }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const input = useRef({ stage, running, reduced })
  const requestDraw = useRef<(() => void) | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    input.current = { stage, running, reduced }
    requestDraw.current?.()
  }, [stage, running, reduced])

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const gl = element.getContext('webgl', {
      alpha: true,
      antialias: true,
      powerPreference: 'low-power',
    })
    if (!gl) {
      onReady(false)
      return
    }
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader)
        return null
      }
      return shader
    }
    const vs = compile(gl.VERTEX_SHADER, vertex)
    const fs = compile(gl.FRAGMENT_SHADER, fragment)
    const program = gl.createProgram()
    if (!vs || !fs || !program) {
      if (vs) gl.deleteShader(vs)
      if (fs) gl.deleteShader(fs)
      if (program) gl.deleteProgram(program)
      onReady(false)
      return
    }
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program)
      onReady(false)
      return
    }
    const buffer = gl.createBuffer()
    if (!buffer) {
      gl.deleteProgram(program)
      onReady(false)
      return
    }
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    for (const [name, size, offset] of [
      ['aPosition', 3, 0],
      ['aColor', 3, 12],
      ['aSize', 1, 24],
    ] as const) {
      const attribute = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(attribute)
      gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 28, offset)
    }
    const aspect = gl.getUniformLocation(program, 'uAspect')
    const dpr = gl.getUniformLocation(program, 'uDpr')
    const tilt = gl.getUniformLocation(program, 'uTilt')
    const points = gl.getUniformLocation(program, 'uPoints')
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    let frame = 0
    let previous = 0
    let clock = 0
    let lastStage = input.current.stage
    let target = constellation(lastStage)
    let origin = target
    let transition = 1
    let width = 1
    let height = 1
    let pixelRatio = 1
    let pointerX = 0
    let pointerY = 0
    let currentX = 0
    let currentY = 0
    let frames = 0
    let lost = false
    const background: Node[] = Array.from({ length: 100 }, (_, index) => ({
      position: [Math.sin(index * 137.4) * 0.94, Math.cos(index * 71.3) * 0.9, 0.45],
      color: [0.16, 0.23, 0.32],
      size: index % 7 === 0 ? 3 : 1.8,
    }))
    const pack = (nodes: Node[]) =>
      new Float32Array(nodes.flatMap((node) => [...node.position, ...node.color, node.size]))
    const drawBatch = (nodes: Node[], mode: number) => {
      gl.bufferData(gl.ARRAY_BUFFER, pack(nodes), gl.DYNAMIC_DRAW)
      gl.uniform1f(points, mode === gl.POINTS ? 1 : 0)
      gl.drawArrays(mode, 0, nodes.length)
    }
    const render = (now: number) => {
      frame = 0
      if (lost) return
      const state = input.current
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0
      previous = now
      if (state.running && !state.reduced) clock += delta
      if (state.stage !== lastStage) {
        origin = target
        target = constellation(state.stage)
        transition = state.reduced ? 1 : 0
        lastStage = state.stage
      }
      transition = state.reduced ? 1 : Math.min(1, transition + delta * 1.1)
      const ease = 1 - Math.pow(1 - transition, 3)
      const nodes = target.map((node, index): Node => {
        const start = origin[index % origin.length].position
        return {
          ...node,
          position: [
            start[0] + (node.position[0] - start[0]) * ease,
            start[1] + (node.position[1] - start[1]) * ease,
            start[2] + (node.position[2] - start[2]) * ease,
          ],
        }
      })
      if (state.running && !state.reduced) {
        currentX += (pointerX - currentX) * 0.05
        currentY += (pointerY - currentY) * 0.05
      }
      gl.viewport(0, 0, element.width, element.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform1f(aspect, width / height)
      gl.uniform1f(dpr, pixelRatio)
      gl.uniform2f(
        tilt,
        state.reduced ? 0 : currentX + Math.sin(clock * 0.15) * 0.08,
        state.reduced ? 0.06 : currentY + 0.1,
      )
      drawBatch(background, gl.POINTS)
      const links: Node[] = []
      const signals: Node[] = []
      if (state.stage > 0) {
        const members = counts[state.stage] / 4
        const compression = Math.min(1, (height / width) * 1.2)
        nodes.forEach((node, index) => {
          const center = centers[Math.floor(index / members)]
          node.position = [
            center[0] + (node.position[0] - center[0]) * compression,
            node.position[1],
            node.position[2],
          ]
        })
        for (let group = 0; group < 4; group++) {
          const center = centers[group]
          const radius = state.stage === 4 ? 0.33 : 0.25
          const orbit = (angle: number): Vec3 => [
            center[0] + Math.cos(angle) * radius * compression,
            center[1] + Math.sin(angle) * radius * 0.68,
            center[2] + Math.sin(angle) * 0.07,
          ]
          for (let segment = 0; segment < 64; segment++) {
            const color: Vec3 = [
              colors[group][0] * 0.13,
              colors[group][1] * 0.13,
              colors[group][2] * 0.13,
            ]
            links.push(
              { position: orbit((segment / 64) * Math.PI * 2), color, size: 1 },
              { position: orbit(((segment + 1) / 64) * Math.PI * 2), color, size: 1 },
            )
          }
          signals.push({ position: orbit(clock * 0.35 + group), color: colors[group], size: 5 })
        }
      }

      const anchor: Vec3 = [0, state.stage === 4 ? 0.16 : 0.79, 0.1]
      const perGroup = state.stage === 0 ? 1 : counts[state.stage] / 4
      for (let index = 0; index < nodes.length; index++) {
        const node = nodes[index]
        const local = index % perGroup
        const parent =
          local === 0 ? anchor : nodes[index - local + Math.floor((local - 1) / 4)].position
        const distance = Math.hypot(node.position[0] - parent[0], node.position[1] - parent[1])
        const arch = local === 0 ? 0.07 : 0.03
        const curve = (progress: number): Vec3 => [
          parent[0] + (node.position[0] - parent[0]) * progress,
          parent[1] + (node.position[1] - parent[1]) * progress,
          parent[2] +
            (node.position[2] - parent[2]) * progress +
            Math.sin(progress * Math.PI) * arch,
        ]
        for (let segment = 0; segment < 5; segment++) {
          links.push(
            {
              position: curve(segment / 5),
              color: [
                node.color[0] * (local === 0 ? 0.3 : 0.17),
                node.color[1] * (local === 0 ? 0.3 : 0.17),
                node.color[2] * (local === 0 ? 0.3 : 0.17),
              ],
              size: 1,
            },
            {
              position: curve((segment + 1) / 5),
              color: [node.color[0] * 0.17, node.color[1] * 0.17, node.color[2] * 0.17],
              size: 1,
            },
          )
        }
        if (distance > 0.01) {
          const progress = (clock * (local === 0 ? 0.23 : 0.35) + index * 0.618) % 1
          for (let trail = 0; trail < 3; trail++)
            signals.push({
              position: curve((progress - trail * 0.025 + 1) % 1),
              color: node.color,
              size: trail === 0 ? 5 : 2.5,
            })
        }
      }
      if (state.stage >= 3) {
        const members = counts[state.stage] / 4
        for (const [from, to] of [
          [0, 1],
          [1, 3],
          [3, 2],
          [2, 0],
        ] as const) {
          const start = nodes[from * members].position
          const end = nodes[to * members].position
          const route = (progress: number): Vec3 => [
            start[0] + (end[0] - start[0]) * progress,
            start[1] + (end[1] - start[1]) * progress + Math.sin(progress * Math.PI) * 0.04,
            start[2] + (end[2] - start[2]) * progress + Math.sin(progress * Math.PI) * 0.1,
          ]
          for (let segment = 0; segment < 16; segment++)
            links.push(
              { position: route(segment / 16), color: [0.08, 0.18, 0.23], size: 1 },
              { position: route((segment + 1) / 16), color: [0.08, 0.18, 0.23], size: 1 },
            )
          signals.push(
            { position: route((clock * 0.2 + from * 0.23) % 1), color: colors[from], size: 6 },
            { position: route(1 - ((clock * 0.17 + to * 0.31) % 1)), color: colors[to], size: 4 },
          )
        }
      }
      if (state.stage === 4) {
        for (let segment = 0; segment < 12; segment++)
          links.push(
            { position: [0, 0.79 - (segment / 12) * 0.63, 0.1], color: [0.3, 0.5, 0.6], size: 1 },
            {
              position: [0, 0.79 - ((segment + 1) / 12) * 0.63, 0.1],
              color: [0.3, 0.5, 0.6],
              size: 1,
            },
          )
        signals.push({
          position: [0, 0.79 - ((clock * 0.3) % 1) * 0.63, 0.1],
          color: [0.8, 0.95, 1],
          size: 8,
        })
      }
      drawBatch(links, gl.LINES)
      drawBatch(signals, gl.POINTS)
      drawBatch(
        nodes.map((node, index) => ({
          ...node,
          size: node.size * (1 + Math.sin(clock * 2 + index) * 0.1),
        })),
        gl.POINTS,
      )
      drawBatch(
        [
          { position: [0, 0.79, 0.1], color: [0.8, 0.95, 1], size: 26 },
          ...(state.stage === 4
            ? [{ position: anchor, color: [0.7, 0.9, 1] as Vec3, size: 58 }]
            : []),
        ],
        gl.POINTS,
      )
      // Wide halos make the GPU point cores feel luminous without an expensive blur pass.
      drawBatch(
        nodes
          .filter((_, index) => index % perGroup === 0)
          .map((node) => ({ ...node, color: [0.12, 0.24, 0.34] as Vec3, size: 100 })),
        gl.POINTS,
      )
      element.dataset.stage = String(state.stage)
      element.dataset.agents = String(nodes.length)
      element.dataset.frames = String(++frames)
      if ((state.running && !state.reduced) || transition < 1) frame = requestAnimationFrame(render)
      else previous = 0
    }
    const schedule = () => {
      if (!frame && !lost) frame = requestAnimationFrame(render)
    }
    const resize = () => {
      const rect = element.getBoundingClientRect()
      width = Math.max(rect.width, 1)
      height = Math.max(rect.height, 1)
      pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75)
      element.width = Math.round(width * pixelRatio)
      element.height = Math.round(height * pixelRatio)
      schedule()
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const rect = element.getBoundingClientRect()
      pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 0.22
      pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 0.12
    }
    const leave = () => {
      pointerX = 0
      pointerY = 0
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      lost = true
      cancelAnimationFrame(frame)
      onReady(false)
    }
    const contextRestored = () => setGeneration((value) => value + 1)
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    element.addEventListener('webglcontextlost', contextLost)
    element.addEventListener('webglcontextrestored', contextRestored)
    requestDraw.current = schedule
    resize()
    onReady(true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      requestDraw.current = null
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
      element.removeEventListener('webglcontextlost', contextLost)
      element.removeEventListener('webglcontextrestored', contextRestored)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [generation, onReady])

  return (
    <div className="fleet-webgl" aria-hidden="true">
      <canvas ref={canvas} />
      <span className="webgl-you">
        YOU<span>Set the direction</span>
      </span>
      {stage === 4 && (
        <span className="webgl-do">
          Do<span>Plan · Delegate · Coordinate</span>
        </span>
      )}
      {stage >= 1 && (
        <div className="webgl-labels">
          {['Your laptop', 'Build server', 'Workstation', 'Test runner'].map((name, index) => (
            <span key={name}>
              {stage >= 3 ? name : ['API', 'Interface', 'Review', 'Delivery'][index]}
              <small>
                {stage >= 3
                  ? `${counts[stage] / 4} agents`
                  : stage === 2
                    ? 'Agent + subagents'
                    : 'Thread agent'}
              </small>
            </span>
          ))}
        </div>
      )}
      {stage === 0 && (
        <span className="webgl-single">
          Your first agent<span>One idea. One thread.</span>
        </span>
      )}
      <div className="webgl-legend">
        <span>● Agents</span>
        <span>↗ Delegation</span>
        <span>↙ Findings</span>
      </div>
    </div>
  )
}
