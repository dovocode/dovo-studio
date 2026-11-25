import { CronExpressionParser } from 'cron-parser'
import { Schema } from 'effect'
import { maxValue, minValue, mutableStruct } from '../shared/schema.js'
import { messageSourceFor } from '../tasks/message-source.js'
import type { Automation, ChatMessage } from '../workspace.js'
import { routineOwnerWords } from './routine-provenance.js'

const id = maxValue(minValue(Schema.String, 1), 200)
export const routineSuggestionFieldsSchema = mutableStruct({
  name: maxValue(Schema.String, 200),
  objective: maxValue(Schema.String, 16000),
  schedule: maxValue(Schema.String, 160),
  timezone: maxValue(Schema.String, 100),
})
export type RoutineSuggestionFields = typeof routineSuggestionFieldsSchema.Type
export const routineSuggestionSaveSchema = mutableStruct({
  id,
  taskId: id,
  messageId: id,
  draft: routineSuggestionFieldsSchema,
})
export const routineSuggestionResultSchema = mutableStruct({ id })

export function routineSuggestionWords(message: ChatMessage | undefined) {
  if (!message || message.role !== 'user' || messageSourceFor(message)?.kind !== 'user') return ''
  if (message.subagentResultId || /^(?:pr-watch|pipeline-watch):/.test(message.id)) return ''
  return routineOwnerWords(message.text)
}

export function routineSuggestionFields(words: string, timezone: string): RoutineSuggestionFields {
  // Fill a time only when the owner's message names a recurrence and a 24-hour time.
  const when =
    /\b(?:every\s+(day|weekday|sunday|monday|tuesday|wednesday|thursday|friday|saturday)|daily|weekdays)\s+at\s+([01]?\d|2[0-3]):([0-5]\d)\b(?!\s*(?:am|pm)\b)/i.exec(
      words,
    )
  const weekday = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ].indexOf(when?.[1]?.toLowerCase() ?? '')
  const days = weekday >= 0 ? String(weekday) : /weekday/i.test(when?.[0] ?? '') ? '1-5' : '*'
  return {
    name: Array.from(words.split('\n')[0]!.trim()).slice(0, 72).join(''),
    objective: words.slice(0, 16000),
    schedule: when ? `${Number(when[3])} ${Number(when[2])} * * ${days}` : '',
    timezone,
  }
}

export function routineSuggestionNextRun(draft: RoutineSuggestionFields, now = new Date()) {
  if (!draft.schedule.trim() || !draft.timezone.trim()) return
  try {
    new Intl.DateTimeFormat('en', { timeZone: draft.timezone.trim() })
    return CronExpressionParser.parse(draft.schedule.trim(), {
      tz: draft.timezone.trim(),
      currentDate: now,
    })
      .next()
      .toDate()
  } catch {
    return undefined
  }
}

export function routineSuggestionAutomation(
  id: string,
  botId: string,
  draft: RoutineSuggestionFields,
): Automation {
  const trigger = {
    kind: 'trigger' as const,
    label: 'Schedule',
    trigger: 'schedule' as const,
    schedule: draft.schedule.trim(),
    timezone: draft.timezone.trim(),
    objective: '',
    agentId: '',
    repositoryId: '',
  }
  return {
    id,
    name: draft.name.trim(),
    enabled: false,
    nodes: [
      { id: 'schedule', type: 'automation', position: { x: 0, y: 0 }, data: trigger },
      {
        id: 'bot',
        type: 'automation',
        position: { x: 330, y: 0 },
        data: {
          ...trigger,
          kind: 'task',
          label: 'Bot task',
          botId,
          objective: draft.objective.trim(),
        },
      },
    ],
    edges: [{ id: 'schedule-bot', source: 'schedule', target: 'bot' }],
  }
}
