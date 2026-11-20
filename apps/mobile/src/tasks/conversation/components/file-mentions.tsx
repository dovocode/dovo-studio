import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView } from 'react-native'
import { Schema } from 'effect'
import {
  modelMentionsSchema,
  agentMentionSuggestions,
  contextMentionSuggestions,
  insertAgentMention,
  insertThreadMention,
  insertBotMention,
  runtimeComputerName,
  insertModelMention,
  type ModelMention,
  type Agent,
  commandSuggestions,
  composerMention,
  insertMention,
  insertPrompt,
  promptSuggestions,
  type SavedPrompt,
  mutableArray,
  mutableStruct,
  resourceSuggestions,
  type ResourceSettings,
} from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
import { BotAvatar } from '../../../bots/bot-avatar'

const filesSchema = mutableStruct({
  files: mutableArray(Schema.String),
  // Older runtimes omit this; they also never report a partial file listing.
  truncated: Schema.optional(Schema.Boolean),
})
type Suggestion = {
  kind: 'file' | 'skill' | 'mcp' | 'command' | 'prompt' | 'model' | 'agent' | 'bot' | 'thread'
  avatar?: string
  value: string
  name?: string
  detail: string
  muted?: boolean
}
export type ComposerCommandId = Exclude<ReturnType<typeof commandSuggestions>[number]['id'], 'goal'>

/** Show reference and command suggestions above the composer. Tap one to insert it. */
export function FileMentions({
  taskId,
  repositoryId,
  text,
  caret,
  resources,
  agents,
  provider,
  onChange,
  onCommand,
  onSideChat,
  prompts = [],
}: {
  taskId: string
  repositoryId?: string
  text: string
  caret: number
  resources: ResourceSettings
  agents: readonly Pick<Agent, 'id' | 'name' | 'provider'>[]
  provider?: string
  onChange: (text: string) => void
  /** Runs a built-in "/" command; its text is removed from the draft. */
  onCommand?: (id: ComposerCommandId) => void
  onSideChat?: (text: string) => void
  /** The project's saved prompts, inserted with "#" (edited on the desktop). */
  prompts?: readonly SavedPrompt[]
}) {
  const uiText = useInterfaceText()

  const { colors } = useTheme()

  const { call, connected, activeId, connection, snapshot, overviews } = useRuntime()
  const [lookup, setLookup] = useState<{
    key: string
    call: typeof call
    files: string[]
    truncated?: boolean
  }>()
  const [modelLookup, setModelLookup] = useState<{
    key: string
    models: ModelMention[]
    error: string
  }>()
  const mention = composerMention(text, caret)
  const trigger = mention?.trigger
  const query = mention?.query
  const threadOnly = trigger === '@' && query?.toLowerCase().startsWith('thread:') === true
  const modelQuery = trigger === '@' && !threadOnly ? query : undefined
  const runtimeId = snapshot?.runtimeId ?? connection?.runtimeId ?? activeId
  const key = JSON.stringify([
    taskId,
    activeId,
    connection?.address,
    connection?.token,
    trigger,
    query,
    connected,
  ])
  const current = lookup?.key === key && lookup.call === call ? lookup : undefined
  const files = current?.files ?? []
  const filesTruncated = current?.truncated === true
  useEffect(() => {
    if (trigger !== '@file:' || query === undefined || !connected) {
      setLookup(undefined)
      return
    }
    setLookup(undefined)
    let disposed = false
    const timer = setTimeout(() => {
      void call('/api/tasks/files', { id: taskId, query }, filesSchema).then(
        (result) => {
          if (!disposed) setLookup({ key, call, files: result.files, truncated: result.truncated })
        },
        () => {
          if (!disposed) setLookup({ key, call, files: [] })
        },
      )
    }, 150)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [trigger, query, taskId, connected, call, key])
  const modelsSupported = snapshot?.modelMentionsSupported === true
  useEffect(() => {
    if (!modelQuery || modelQuery.length < 2 || !connected || !modelsSupported) return
    let stopped = false
    const timer = setTimeout(() => {
      void call(
        '/api/agents/model-mentions',
        { taskId, query: modelQuery },
        modelMentionsSchema,
      ).then(
        (result) => {
          if (!stopped)
            setModelLookup({
              key,
              models: result.models,
              error: result.unavailable.length
                ? `Models unavailable: ${result.unavailable.join(', ')}`
                : '',
            })
        },
        (cause: unknown) => {
          if (!stopped) setModelLookup({ key, models: [], error: String(cause) })
        },
      )
    }, 180)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [modelQuery, connected, modelsSupported, call, taskId, key])
  if (!mention) return null
  const suggestedResources = threadOnly
    ? []
    : resourceSuggestions(resources, mention.trigger, mention.query)
  const suggestions: Suggestion[] = [
    ...(mention.trigger === '@'
      ? contextMentionSuggestions(
          overviews.map((owner) => ({
            runtimeId:
              owner.snapshot?.runtimeId ?? owner.profile.connection.runtimeId ?? owner.profile.id,
            name: runtimeComputerName(owner),
            tasks: owner.snapshot?.workspace.tasks ?? [],
          })),
          mention.query,
        ).map((bot) => ({
          kind: bot.kind ?? ('bot' as const),
          value: bot.reference,
          name: bot.name,
          detail: bot.detail,
          avatar: bot.avatar,
        }))
      : []),
    ...(mention.trigger === '@' && !threadOnly && runtimeId
      ? agentMentionSuggestions(runtimeId, repositoryId, agents, mention.query).map((agent) => ({
          ...agent,
          value: agent.reference,
        }))
      : []),
    ...(modelsSupported && modelLookup?.key === key
      ? modelLookup.models.map((model) => ({
          kind: 'model' as const,
          value: model.reference,
          name: model.name,
          detail: `${model.provider} · ${model.model}`,
        }))
      : []),
    ...(mention.trigger === '#'
      ? promptSuggestions(prompts, mention.query).map((prompt) => ({
          kind: 'prompt' as const,
          value: prompt.id,
          name: prompt.name,
          detail: prompt.text.replace(/\s+/g, ' ').slice(0, 60),
        }))
      : []),
    ...(mention.trigger === '/' && onSideChat && 'sidechat'.startsWith(mention.query.toLowerCase())
      ? [{ kind: 'command' as const, value: 'sidechat', detail: 'Start an agent side chat' }]
      : []),
    ...(mention.trigger === '/'
      ? commandSuggestions(
          mention.query,
          provider,
          snapshot?.workspace.tasks.find((task) => task.id === taskId)?.nativeGoalSupported ===
            true,
        )
          .filter((item) => item.id === 'goal' || onCommand)
          .map((command) => ({
            kind: 'command' as const,
            value: command.id,
            detail: command.description,
          }))
      : []),
    ...suggestedResources.map((item) => ({
      kind: item.kind,
      value: item.name,
      detail:
        item.kind === 'mcp'
          ? 'MCP server'
          : `${item.enabled ? 'Skill' : 'Skill · this message only'}${item.description ? ` · ${item.description}` : ''}`,
      muted: !item.enabled,
    })),
    ...(mention.trigger === '@file:'
      ? files.map((path) => {
          const slash = path.lastIndexOf('/')
          return {
            kind: 'file' as const,
            value: path,
            detail: slash > 0 ? path.slice(0, slash) : '',
          }
        })
      : []),
  ]
  const modelError =
    connected && modelsSupported && modelLookup?.key === key ? modelLookup.error : ''
  const truncatedNotice = mention.trigger === '@file:' && filesTruncated
  if (!suggestions.length && !modelError && !truncatedNotice) return null
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={
        mention.trigger === '@file:'
          ? uiText('File suggestions')
          : mention.trigger === '@'
            ? threadOnly
              ? uiText('Thread suggestions')
              : uiText('Agent, Bot, model and MCP server suggestions')
            : uiText('Skill suggestions')
      }
      contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingVertical: 6 }}
    >
      {!!modelError && (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.muted, fontSize: 12, maxWidth: 240 }}
        >
          {modelError}
        </Text>
      )}
      {truncatedNotice && (
        <Text accessibilityRole="text" style={{ color: colors.muted, fontSize: 12, maxWidth: 240 }}>
          {uiText(
            'This project has more files than file search covers. Type more of the path if a file is missing.',
          )}
        </Text>
      )}
      {suggestions.map((item) => {
        const name = item.name ?? item.value
        const label =
          item.kind === 'file'
            ? item.value.slice(item.value.lastIndexOf('/') + 1)
            : item.kind === 'command'
              ? `/${name}`
              : item.kind === 'prompt'
                ? `#${name}`
                : name
        return (
          <Pressable
            key={`${item.kind}:${item.value}`}
            accessibilityRole="button"
            accessibilityLabel={
              item.kind === 'command'
                ? uiText('Command {value0}: {value1}', { value0: item.value, value1: item.detail })
                : item.kind === 'prompt'
                  ? uiText('Insert saved prompt {value0}', { value0: item.name })
                  : item.kind === 'bot'
                    ? uiText('Mention Bot {value0}: {value1}', {
                        value0: name,
                        value1: item.detail,
                      })
                    : item.kind === 'agent'
                      ? uiText('Mention agent {value0}', { value0: name })
                      : item.kind === 'thread'
                        ? uiText('Mention thread {value0}: {value1}', {
                            value0: name,
                            value1: item.detail,
                          })
                        : uiText('Mention {value0} {value1}', {
                            value0: item.kind === 'mcp' ? 'MCP server' : item.kind,
                            value1: item.value,
                          })
            }
            onPress={() => {
              if (item.kind === 'thread') {
                onChange(
                  insertThreadMention(text, mention.start, caret, {
                    name,
                    reference: item.value,
                  }).text,
                )
                return
              }
              if (item.kind === 'bot' || item.kind === 'agent') {
                const insert = item.kind === 'bot' ? insertBotMention : insertAgentMention
                onChange(
                  insert(text, mention.start, caret, {
                    name,
                    reference: item.value,
                  }).text,
                )
              } else if (item.kind === 'model')
                onChange(insertModelMention(text, mention.start, caret, item.value).text)
              else if (item.kind === 'prompt') {
                const prompt = prompts.find((entry) => entry.id === item.value)
                if (prompt) onChange(insertPrompt(text, mention.start, caret, prompt.text).text)
              } else if (item.kind === 'command') {
                if (item.value === 'goal') {
                  onChange(insertMention(text, mention.start, caret, 'goal', '/').text)
                  setLookup(undefined)
                  return
                }
                const remaining = text.slice(0, mention.start) + text.slice(caret)
                onChange(remaining)
                if (item.value === 'sidechat') onSideChat?.(remaining)
                else onCommand?.(item.value as ComposerCommandId)
              } else
                onChange(
                  insertMention(text, mention.start, caret, item.value, mention.trigger).text,
                )
              setLookup(undefined)
            }}
            style={({ pressed }) => ({
              maxWidth: 240,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 14,
              backgroundColor: colors.elevated,
              opacity: pressed ? 0.6 : item.muted ? 0.75 : 1,
            })}
          >
            {item.kind === 'bot' && (
              <BotAvatar avatar={item.avatar} name={item.name ?? 'Bot'} size={24} />
            )}
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13 }}>
              {label}
            </Text>
            {!!item.detail && (
              <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 11 }}>
                {item.detail}
              </Text>
            )}
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
