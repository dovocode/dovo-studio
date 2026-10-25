import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { type CallToolResult, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import sharp from 'sharp'
import {
  decode,
  mutableStruct,
  type RemoteDesktopFrame,
  type RemoteDesktopRequest,
} from '@dovo/protocol'
import { Schema } from 'effect'
import { detectCua } from './cua.js'
import { desktopLocked } from './desktop-lock.js'
import { processEnvironment } from '../process.js'
import { HttpError } from '../errors.js'

type Tool =
  | 'get_desktop_state'
  | 'click'
  | 'press_key'
  | 'type_text'
  | 'scroll'
  | 'end_session'
  | 'move_cursor'
  | 'drag'
export interface DesktopDriver {
  call(name: Tool, args: Record<string, unknown>): Promise<CallToolResult>
  close(): Promise<void>
}
async function connectDesktopDriver(command: string): Promise<DesktopDriver> {
  const path = await detectCua(command)
  if (!path)
    throw new HttpError(409, 'Set up Cua Driver in Computer use settings on this computer first.')
  const client = new Client({ name: 'dovo-remote-desktop', version: '1' })
  const transport = new StdioClientTransport({
    command: path,
    args: ['mcp'],
    env: Object.fromEntries(
      Object.entries(processEnvironment()).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    stderr: 'pipe',
  })
  transport.stderr?.on('data', () => {})
  try {
    await client.connect(transport, { timeout: 15000 })
    const tools = await client.listTools({}, { timeout: 15000 })
    return {
      call: async (name, args) =>
        CallToolResultSchema.parse(
          await client.callTool(
            {
              name,
              arguments: Object.fromEntries(
                Object.entries(args).filter(
                  ([key]) =>
                    key !== 'delivery_mode' ||
                    Object.hasOwn(
                      tools.tools.find((tool) => tool.name === name)?.inputSchema.properties ?? {},
                      key,
                    ),
                ),
              ),
            },
            undefined,
            { timeout: 15000 },
          ),
        ),
      close: () => client.close(),
    }
  } catch (error) {
    await transport.close()
    throw error
  }
}
const captureSchema = mutableStruct({ capture_id: Schema.String })
type Session = {
  id: string
  deviceId: string
  viewer: string
  control: boolean
  locked: boolean
  seen: number
  driver: Promise<DesktopDriver>
  busy: boolean
  pending: Promise<void>
  frame?: { value: RemoteDesktopFrame; captureId: string; time: number }
  inputs: Set<string>
  unlock?: () => void
}

/** One human viewer per runtime; no agent credentials or arbitrary driver calls. */
export class RemoteDesktop {
  private session?: Session
  private disposed = false
  private closing: Promise<void> = Promise.resolve()
  private readonly expiry = setInterval(() => {
    if (this.session && (!this.enabled() || Date.now() - this.session.seen > 30000))
      void this.stop().catch((error) => this.report(error))
  }, 1000).unref()
  constructor(
    private enabled: () => boolean,
    private command: () => string,
    private changed: () => void,
    private report: (error: unknown) => void,
    private connect: (command: string) => Promise<DesktopDriver> = connectDesktopDriver,
    private isLocked: () => Promise<boolean> = desktopLocked,
  ) {}
  status() {
    const session = this.session
    return session && this.enabled()
      ? {
          id: session.id,
          viewer: session.viewer,
          control: session.control,
          ...(session.locked ? { locked: true } : {}),
          ...(session.locked && process.platform === 'darwin'
            ? { unlockUsername: userInfo().username }
            : {}),
          ...(session.unlock ? { unlocking: true } : {}),
        }
      : null
  }
  private assert(session: Session, authorize: () => void) {
    authorize()
    if (this.disposed || !this.enabled())
      throw new HttpError(403, 'Experimental remote desktop is disabled on this computer.')
    if (this.session !== session)
      throw new HttpError(410, 'Desktop session ended. Start a new session.')
  }
  private async refreshLockState(session: Session, authorize: () => void) {
    const locked = await this.isLocked()
    this.assert(session, authorize)
    if (locked !== session.locked) {
      session.locked = locked
      if (locked) {
        session.control = false
        session.frame = undefined
      }
      this.changed()
    }
    return locked
  }
  authorizeUnlock(id: string, deviceId: string, authorize: () => void) {
    const session = this.session
    if (!session || session.id !== id)
      throw new HttpError(410, 'Desktop session ended. Start a new session.')
    this.assert(session, authorize)
    if (session.deviceId !== deviceId)
      throw new HttpError(403, 'This desktop session belongs to another device.')
    if (!session.locked && !session.unlock)
      throw new HttpError(409, 'The desktop is no longer locked.')
    return session
  }
  attachUnlock(id: string, deviceId: string, authorize: () => void, close: () => void) {
    const session = this.authorizeUnlock(id, deviceId, authorize)
    if (session.unlock) throw new HttpError(409, 'An unlock connection is already active.')
    session.unlock = close
    this.changed()
    return () => {
      if (session.unlock !== close) return
      session.unlock = undefined
      this.changed()
    }
  }
  async request(
    input: RemoteDesktopRequest,
    deviceId: string,
    viewer: string,
    authorize: () => void,
  ) {
    authorize()
    if (input.action === 'stop') {
      if (this.session?.id === input.id) {
        await this.stop()
      }
      return { session: null }
    }
    if (!this.enabled() || this.disposed)
      throw new HttpError(403, 'Experimental remote desktop is disabled on this computer.')
    if (input.action === 'start' && !this.session) {
      // Reserve synchronously before connecting. Concurrent starts cannot create two drivers.
      const session: Session = {
        id: input.id,
        deviceId,
        viewer,
        control: false,
        locked: false,
        seen: Date.now(),
        busy: false,
        pending: Promise.resolve(),
        inputs: new Set(),
        driver: this.closing.then(
          () => {
            this.assert(session, authorize)
            return this.connect(this.command())
          },
          () => {
            this.assert(session, authorize)
            return this.connect(this.command())
          },
        ),
      }
      this.session = session
      this.changed()
    }
    const session = this.session
    if (!session || session.id !== input.id)
      throw new HttpError(409, 'Another desktop session is active, or this session has ended.')
    if (session.deviceId !== deviceId)
      throw new HttpError(403, 'This desktop session belongs to another device.')
    this.assert(session, authorize)
    session.seen = Date.now()
    if (session.busy)
      throw new HttpError(409, 'Desktop is busy. Wait for the current frame or action.')
    session.busy = true
    let finish = () => {}
    session.pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    let failedStart = false
    try {
      const driver = await session.driver
      this.assert(session, authorize)
      if (await this.refreshLockState(session, authorize)) return { session: this.status() }
      if (input.action === 'control') {
        session.control = input.enabled
        this.changed()
        return { session: this.status() }
      }
      if (input.action === 'input') {
        if (!session.control)
          throw new HttpError(403, 'Enable control before sending desktop input.')
        if (session.inputs.has(input.requestId))
          throw new HttpError(
            409,
            'This input was already attempted. Refresh the desktop before trying again.',
          )
        const frame = session.frame
        if (!frame || frame.value.id !== input.frameId || Date.now() - frame.time > 10000)
          throw new HttpError(409, 'Desktop image is stale. Refresh before sending input.')
        session.inputs.add(input.requestId)
        if (session.inputs.size > 4096)
          throw new HttpError(409, 'Start a new desktop session to continue.')
        const target = { kind: 'desktop', display_id: 'primary' }
        const action = input.input
        const args: Record<string, unknown> = { session: session.id, target }
        let tool: Tool
        if (action.type === 'click') {
          if (action.x >= frame.value.width || action.y >= frame.value.height)
            throw new HttpError(400, 'Click is outside the desktop image.')
          tool = 'click'
          Object.assign(args, {
            x: action.x,
            y: action.y,
            button: action.button,
            count: action.count,
            capture_id: frame.captureId,
          })
        } else if (action.type === 'move' || action.type === 'drag') {
          const points =
            action.type === 'drag'
              ? [
                  [action.x, action.y],
                  [action.toX, action.toY],
                ]
              : [[action.x, action.y]]
          if (points.some(([x, y]) => x >= frame.value.width || y >= frame.value.height))
            throw new HttpError(400, 'Pointer is outside the desktop image.')
          if (action.type === 'move') {
            tool = 'move_cursor'
            Object.assign(args, { x: action.x, y: action.y, delivery_mode: 'foreground' })
          } else {
            tool = 'drag'
            Object.assign(args, {
              from_x: action.x,
              from_y: action.y,
              to_x: action.toX,
              to_y: action.toY,
              duration_ms: 300,
              delivery_mode: 'foreground',
            })
          }
        } else if (action.type === 'key') {
          tool = 'press_key'
          args.key = action.key
          args.modifiers = action.modifiers ?? []
        } else if (action.type === 'text') {
          tool = 'type_text'
          args.text = action.text
        } else {
          tool = 'scroll'
          args.direction = action.direction
          args.amount = action.amount
          args.x = action.x ?? frame.value.width / 2
          args.y = action.y ?? frame.value.height / 2
          if (Number(args.x) >= frame.value.width || Number(args.y) >= frame.value.height)
            throw new HttpError(400, 'Scroll is outside the desktop image.')
        }
        session.frame = undefined
        this.assert(session, authorize)
        await this.call(driver, tool, args)
        this.assert(session, authorize)
      }
      const result = await this.call(driver, 'get_desktop_state', {
        session: session.id,
        max_image_dimension: 1600,
      })
      this.assert(session, authorize)
      const image = result.content.find(
        (part) => part.type === 'image' && part.mimeType === 'image/png',
      )
      if (!image || image.type !== 'image' || image.data.length > 24 * 1024 * 1024)
        throw new Error(
          'Cua Driver returned no usable desktop screenshot. Check host permissions and driver version.',
        )
      const capture = decode(captureSchema, result.structuredContent)
      const source = Buffer.from(image.data, 'base64')
      const pipeline = sharp(source, { limitInputPixels: 1600 * 1600 })
      const metadata = await pipeline.metadata()
      if (!metadata.width || !metadata.height)
        throw new Error('Desktop screenshot dimensions are unavailable.')
      const jpeg = await pipeline.jpeg({ quality: 75 }).toBuffer()
      // A lock while capture was in flight must also discard the image and pending control.
      if (await this.refreshLockState(session, authorize)) return { session: this.status() }
      const frame: RemoteDesktopFrame = {
        id: randomUUID(),
        image: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        width: metadata.width,
        height: metadata.height,
      }
      session.frame = { value: frame, captureId: capture.capture_id, time: Date.now() }
      // WindowServer may report unlocked before capture is available. Keep the
      // authenticated OS screen alive until its replacement is actually ready.
      session.unlock?.()
      return { session: this.status(), frame }
    } catch (error) {
      failedStart = input.action === 'start'
      throw error
    } finally {
      session.busy = false
      finish()
      if (failedStart && this.session === session) await this.stop()
    }
  }
  private async call(driver: DesktopDriver, name: Tool, args: Record<string, unknown>) {
    const result = await driver.call(name, args)
    if (result.isError)
      throw new Error(
        result.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .slice(0, 2000) || 'Desktop action failed. Refresh before retrying.',
      )
    return result
  }
  async stop() {
    const session = this.session
    if (!session) return this.closing
    this.session = undefined
    session.unlock?.()
    this.changed()
    this.closing = (async () => {
      let driver: DesktopDriver
      try {
        driver = await session.driver
      } catch {
        return
      } // Connection failures are returned to the start request.
      await session.pending
      try {
        await this.call(driver, 'end_session', { session: session.id })
      } finally {
        await driver.close()
      }
    })()
    return this.closing
  }
  async dispose() {
    this.disposed = true
    clearInterval(this.expiry)
    await this.stop()
  }
}
