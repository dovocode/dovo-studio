import { lstat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import type { NativeThreadEntry } from '@dovo/protocol'
import { openValidatedPreview } from '../../../scm/repositories/file-preview-open.js'
import type { AcpLaunch } from '../../execution/types.js'
import { antigravityProfile, antigravitySessionId } from './antigravity-profile.js'

const descriptor = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ conversationId: Schema.optional(Schema.String) })),
)
const transcriptStep = Schema.Struct({
  step_index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  type: Schema.String,
  content: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  tool_calls: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
})
const decodeStep = Schema.decodeUnknownOption(Schema.fromJsonString(transcriptStep))
const boundaries = new Set(['PLANNER_RESPONSE', 'SYSTEM_MESSAGE', 'USER_INPUT', 'ERROR_MESSAGE'])

async function readOwnedLog(path: string, limit: number, tail = false) {
  const { handle } = await openValidatedPreview(async () => {
    const stat = await lstat(path)
    if (
      stat.nlink !== 1 ||
      (process.getuid && stat.uid !== process.getuid()) ||
      (await realpath(path)) !== path
    )
      throw new Error('Antigravity log is outside the owned profile')
    return path
  })
  try {
    const { size } = await handle.stat()
    if (!tail && size > limit) return
    const start = Math.max(0, size - limit)
    const bytes = Buffer.alloc(size - start)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, start + length)
      if (!bytesRead) return
      length += bytesRead
    }
    const newline = start > 0 ? bytes.indexOf(10) : -1
    if (start > 0 && newline < 0) return ''
    return bytes.toString('utf8', newline + 1)
  } finally {
    await handle.close()
  }
}

function deliveredMessage(text = '') {
  const delivered = text.indexOf('\n[Message] ')
  if (delivered < 0 && !text.startsWith('[Message] ')) return
  const start = text.indexOf(' content=', Math.max(0, delivered))
  if (start < 0) return
  const end = text.indexOf('</SYSTEM_MESSAGE>', start)
  return text.slice(start + ' content='.length, end < 0 ? undefined : end)
}

function projectTranscript(source: string): NativeThreadEntry[] {
  const steps = new Map<number, typeof transcriptStep.Type>()
  for (const line of source.split('\n')) {
    if (!line) continue
    const step = decodeStep(line)
    if (step._tag === 'Some') steps.set(step.value.step_index, step.value)
  }
  const ordered = [...steps.values()].sort((a, b) => a.step_index - b.step_index)
  const entries: NativeThreadEntry[] = []
  for (let index = 0; index < ordered.length; index++) {
    const step = ordered[index]
    const add = (
      role: NativeThreadEntry['role'],
      text?: string,
      label?: string,
      suffix: string = role,
    ) => {
      const value =
        text
          ?.trim()
          .slice(0, 16000)
          .replace(/[\uD800-\uDBFF]$/u, '') ?? ''
      if (value || label)
        entries.push({
          id: `${step.step_index}:${suffix}`,
          role,
          text: value,
          ...(label ? { label } : {}),
        })
    }
    if (step.type === 'USER_INPUT' || step.type === 'SYSTEM_MESSAGE') {
      add('user', step.type === 'USER_INPUT' ? step.content : deliveredMessage(step.content))
    } else if (step.type === 'PLANNER_RESPONSE') {
      add('reasoning', step.thinking)
      add('assistant', step.content)
      for (const [toolIndex, tool] of (step.tool_calls ?? []).entries()) {
        while (ordered[index + 1]?.type === 'CHECKPOINT') index++
        const next = ordered[index + 1]
        const result = next && !boundaries.has(next.type) ? ordered[++index] : undefined
        add('tool', result?.error ?? result?.content, tool.name.slice(0, 120), `tool-${toolIndex}`)
      }
    } else if (step.error || step.type === 'ERROR_MESSAGE') {
      add('tool', step.error ?? step.content, 'Antigravity error')
    }
  }
  return entries
}

export async function readAntigravityTranscript(launch: AcpLaunch, child: string, parent?: string) {
  const profile = antigravityProfile(launch)
  if (
    !profile ||
    !parent ||
    child === parent ||
    !antigravitySessionId.test(child) ||
    !antigravitySessionId.test(parent)
  )
    return
  try {
    const brain = join(await realpath(profile), 'antigravity-acp', 'brain')
    const record = await readOwnedLog(
      join(brain, parent, '.system_generated', 'subagents', `${child}.json`),
      16384,
    )
    if (!record) return
    const owned = descriptor(record)
    if (owned._tag !== 'Some' || (owned.value.conversationId ?? child) !== child) return
    const transcript = await readOwnedLog(
      join(brain, child, '.system_generated', 'logs', 'transcript.jsonl'),
      1024 * 1024,
      true,
    )
    if (transcript !== undefined) return projectTranscript(transcript)
  } catch {
    // Missing, unowned, or unsupported provider data leaves the saved prompt/result available.
    return undefined
  }
}
