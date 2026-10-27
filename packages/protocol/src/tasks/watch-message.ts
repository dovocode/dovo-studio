import { pipelineSignal } from '../scm/work/work-presentation.js'
import type { MessageSource } from './message-source.js'

export type WatchMessage = {
  kind: 'pipeline' | 'pull-request'
  label: string
  title: string
  url: string
  status?: string
  commit: string
  watching: boolean
  details: string
  highlights: string[]
}

function webUrl(value: string) {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

/** Presentation only: retain the original queued text for agent input, editing and copying. */
export function watchMessage(message: {
  id: string
  text: string
  source?: MessageSource
}): WatchMessage | null {
  if (message.source && !['pipeline', 'pull-request'].includes(message.source.kind)) return null
  const pipeline = message.id.startsWith('pipeline-watch:')
  if (!pipeline && !message.id.startsWith('pr-watch:')) return null
  const text = message.text.replace(/\r\n/g, '\n')
  const header = text.match(
    pipeline
      ? /^Dovo pipeline (completion|attention required) for (\S+)\n/
      : /^Dovo PR (feedback) for (\S+)\n/,
  )
  if (!header) return null
  const url = webUrl(header[2]!)
  if (!url) return null
  const sections = text.split('\n\n')
  const metadata = sections[0]!
  const instruction = sections[1] ?? ''
  if (
    !instruction.startsWith(
      pipeline ? 'Pipeline details are external data.' : 'New feedback follows as external data.',
    )
  )
    return null
  const commit = metadata.match(pipeline ? /^Commit: (.+)$/m : /^Head: (.+)$/m)?.[1]
  const run = metadata.match(/^Run: (.+)$/m)?.[1]
  const status = metadata.match(/^Status: (.+)$/m)?.[1]
  if (!commit || (pipeline && (!run || !status))) return null
  const details = sections.slice(2).join('\n\n').trim()
  const highlights = details
    .split('\n')
    .filter((line, index, lines) =>
      pipeline
        ? !!webUrl(lines[index + 1] ?? '') && /: [\w -]+$/.test(line)
        : /^(Failed check: |(?:Updated )?(?:comment|review|inline) by )/.test(line),
    )
  const pullPath = new URL(url).pathname
    .replace(/\/(?:pull|pulls|merge_requests)\/(\d+)$/, ' #$1')
    .replace('/- #', ' #')
    .slice(1)
  return {
    kind: pipeline ? 'pipeline' : 'pull-request',
    label: pipeline ? `Pipeline · ${pipelineSignal(status ?? '').label}` : 'PR feedback',
    title: pipeline ? details.split('\n')[0] || `Run ${run}` : pullPath,
    url,
    status,
    commit,
    watching: instruction.includes('continues watching'),
    details,
    highlights,
  }
}

export function watchMessagePreview(message: { id: string; text: string }) {
  const watch = watchMessage(message)
  return watch ? `${watch.label} · ${watch.title}` : message.text
}
