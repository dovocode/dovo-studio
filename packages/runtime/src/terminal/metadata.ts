import {
  decodeResult,
  terminalActivitySchema,
  terminalChildActivityLimit,
  terminalChildIdSchema,
  terminalTextSchema,
  terminalTitleSchema,
  terminalTurnIdSchema,
  type TerminalActivity,
  type TerminalInfo,
} from '@dovo/protocol'

type ChildEvent = { type: 'children'; id?: string; activity?: TerminalActivity }
type MetadataEvent =
  | ChildEvent
  | { type: 'title'; title: string | undefined }
  | { type: 'activity'; activity: TerminalActivity | undefined; turnId?: string }

// OSC 7501 specification: https://www.superlogical.com/rex/docs/build/program-status
function activityReport(
  body: string,
): { id?: string; activity?: TerminalActivity; turnId?: string } | undefined {
  const fields = new Map<string, string>()
  for (const pair of body.split(':')) {
    const equals = pair.indexOf('=')
    if (equals < 0) continue
    const key = pair.slice(0, equals).trim()
    const value = pair.slice(equals + 1).trim()
    if (Buffer.byteLength(key) > 16) return
    if (key === 'turnId') {
      if (!decodeResult(terminalTurnIdSchema, value).success) return
      fields.set(key, value)
      continue
    }
    if (key === 'id' && !decodeResult(terminalChildIdSchema, value).success) return
    if (
      (key === 'app' && Buffer.byteLength(value) > 32) ||
      (key === 'title' && value.length > 256) ||
      (key === 'msg' && value.length > 2732)
    )
      return
    if (/^[a-z]+$/.test(key) && /^[A-Za-z0-9_.,+/=-]*$/.test(value)) fields.set(key, value)
  }
  const state = fields.get('state')
  if (!state) return
  const text = (key: string, limit: number) => {
    const encoded = fields.get(key)
    if (!encoded) return ''
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return
    const bytes = Buffer.from(encoded, 'base64')
    if (
      bytes.length > limit ||
      bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '') ||
      (encoded.includes('=') && encoded.length % 4 !== 0)
    )
      return
    const value = bytes.toString('utf8')
    if (!Buffer.from(value, 'utf8').equals(bytes)) return
    return decodeResult(terminalTextSchema, value).success ? value : undefined
  }
  const title = text('title', 192)
  const message = text('msg', 2048)
  if (title === undefined || message === undefined) return
  const id = fields.get('id')
  const turnId = fields.get('turnId')
  if (state === 'clear') return { id, ...(turnId ? { turnId } : {}) }
  const app = fields.get('app')
  const kind = state === 'blocked' ? fields.get('kind') : undefined
  const progress = fields.get('progress')
  const result = decodeResult(terminalActivitySchema, {
    state,
    ...(turnId ? { turnId } : {}),
    ...(app && /^[A-Za-z0-9_.+-]{1,32}$/.test(app) ? { app } : {}),
    ...(title ? { title } : {}),
    ...(message ? { message } : {}),
    ...(kind && ['permission', 'question', 'auth'].includes(kind) ? { kind } : {}),
    ...((state === 'working' || state === 'blocked') &&
    progress &&
    /^\d+$/.test(progress) &&
    Number(progress) <= 100
      ? { progress: Number(progress) }
      : {}),
  })
  return result.success ? { id, activity: result.data } : undefined
}

/** Child clear also removes descendants. Keep the most recently reported records at capacity. */
export function updateChildActivities(
  current: TerminalInfo['childActivities'],
  { id, activity }: ChildEvent,
): TerminalInfo['childActivities'] {
  if (!id) return undefined
  const records = (current ?? []).filter(
    (child) => child.id !== id && (activity !== undefined || !child.id.startsWith(id + '/')),
  )
  if (activity) records.push({ id, activity })
  return records.length ? records.slice(-terminalChildActivityLimit) : undefined
}

/** A bounded metadata observer. The PTY bytes themselves always pass through unchanged. */
export class TerminalMetadata {
  private mode: 'ground' | 'escape' | 'osc' | 'osc-escape' | 'string' | 'string-escape' = 'ground'
  private body = ''
  private oversized = false
  private activity: TerminalActivity | undefined
  private readonly changed: (event: MetadataEvent) => void
  constructor(changed: (event: MetadataEvent) => void) {
    this.changed = changed
  }

  endProcess() {
    if (this.activity && !['done', 'error'].includes(this.activity.state)) this.setActivity()
    else this.changed({ type: 'children' })
  }

  private setActivity(activity?: TerminalActivity, turnId?: string) {
    if (!activity) this.changed({ type: 'children' })
    this.activity = activity
    this.changed({ type: 'activity', activity, ...(turnId ? { turnId } : {}) })
  }

  private complete() {
    const body = this.body
    this.body = ''
    this.mode = 'ground'
    if (this.oversized || Buffer.byteLength(body) + 4 > 4096) return
    const separator = body.indexOf(';')
    const command = body.slice(0, separator)
    const value = body.slice(separator + 1)
    if (separator < 0) return
    if (command === '0' || command === '2') {
      if (!value) this.changed({ type: 'title', title: undefined })
      else if (decodeResult(terminalTitleSchema, value).success)
        this.changed({ type: 'title', title: value })
    } else if (command === '7501') {
      const report = activityReport(value)
      if (!report) return
      if (report.id) this.changed({ type: 'children', ...report })
      else this.setActivity(report.activity, report.turnId)
    } else if (command === '133' && (value === 'A' || value.startsWith('A;'))) {
      this.endProcess()
    }
  }

  write(data: string) {
    for (let index = 0; index < data.length; index++) {
      const char = data[index]
      if (this.mode === 'ground') {
        const start = data.indexOf('\x1b', index)
        if (start < 0) return
        index = start
        this.mode = 'escape'
      } else if (this.mode === 'escape') {
        if (char === ']') {
          this.mode = 'osc'
          this.body = ''
          this.oversized = false
        } else if (['P', 'X', '^', '_'].includes(char)) this.mode = 'string'
        else {
          if (char === 'c') this.setActivity()
          this.mode = char === '\x1b' ? 'escape' : 'ground'
        }
      } else if (this.mode === 'string' || this.mode === 'string-escape') {
        if (char === '\x18' || char === '\x1a' || (this.mode === 'string-escape' && char === '\\'))
          this.mode = 'ground'
        else this.mode = char === '\x1b' ? 'string-escape' : 'string'
      } else if (char === '\x07' || (this.mode === 'osc-escape' && char === '\\')) {
        this.complete()
      } else if (char === '\x18' || char === '\x1a') {
        this.body = ''
        this.mode = 'ground'
      } else if (char === '\x1b') this.mode = 'osc-escape'
      else if (this.mode === 'osc-escape') {
        // An ESC that isn't ST cancels this OSC and starts a new escape sequence.
        this.body = ''
        this.mode = this.oversized ? 'osc' : 'escape'
        if (!this.oversized) index--
      } else if (!this.oversized) {
        if (this.body.length >= 4092) {
          this.oversized = true
          this.body = ''
        } else this.body += char
      }
    }
  }
}
