import { useEffect, useState } from 'react'
import { Pressable, ScrollView } from 'react-native'
import { Schema } from 'effect'
import {
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

const filesSchema = mutableStruct({ files: mutableArray(Schema.String) })
type Suggestion = {
  kind: 'file' | 'skill' | 'mcp' | 'command' | 'prompt'
  value: string
  name?: string
  detail: string
  muted?: boolean
}
export type ComposerCommandId = ReturnType<typeof commandSuggestions>[number]['id']

/** Mention suggestions above the composer: "@" files and MCP servers, "$" skills, and "/"
 * skills at the start of a line. Tap one to insert it. */
export function FileMentions({
  taskId,
  text,
  caret,
  resources,
  onChange,
  onCommand,
  prompts = [],
}: {
  taskId: string
  text: string
  caret: number
  resources: ResourceSettings
  onChange: (text: string) => void
  /** Runs a built-in "/" command; its text is removed from the draft. */
  onCommand?: (id: ComposerCommandId) => void
  /** The project's saved prompts, inserted with "#" (edited on the desktop). */
  prompts?: readonly SavedPrompt[]
}) {
  const { colors } = useTheme()

  const { call, connected, activeId, connection } = useRuntime()
  const [lookup, setLookup] = useState<{ key: string; call: typeof call; files: string[] }>()
  const mention = composerMention(text, caret)
  const trigger = mention?.trigger
  const query = mention?.query
  const key = JSON.stringify([
    taskId,
    activeId,
    connection?.address,
    connection?.token,
    trigger,
    query,
    connected,
  ])
  const files = lookup?.key === key && lookup.call === call ? lookup.files : []
  useEffect(() => {
    if (trigger !== '@' || query === undefined || !connected) {
      setLookup(undefined)
      return
    }
    setLookup(undefined)
    let disposed = false
    const timer = setTimeout(() => {
      void call('/api/tasks/files', { id: taskId, query }, filesSchema).then(
        (result) => {
          if (!disposed) setLookup({ key, call, files: result.files })
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
  if (!mention) return null
  const suggestions: Suggestion[] = [
    ...(mention.trigger === '#'
      ? promptSuggestions(prompts, mention.query).map((prompt) => ({
          kind: 'prompt' as const,
          value: prompt.id,
          name: prompt.name,
          detail: prompt.text.replace(/\s+/g, ' ').slice(0, 60),
        }))
      : []),
    ...(mention.trigger === '/' && onCommand
      ? commandSuggestions(mention.query).map((command) => ({
          kind: 'command' as const,
          value: command.id,
          detail: command.description,
        }))
      : []),
    ...resourceSuggestions(resources, mention.trigger, mention.query).map((item) => ({
      kind: item.kind,
      value: item.name,
      detail:
        item.kind === 'mcp'
          ? 'MCP server'
          : `${item.enabled ? 'Skill' : 'Skill · this message only'}${item.description ? ` · ${item.description}` : ''}`,
      muted: !item.enabled,
    })),
    ...(mention.trigger === '@'
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
  if (!suggestions.length) return null
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={
        mention.trigger === '@' ? 'File and MCP server suggestions' : 'Skill suggestions'
      }
      contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingVertical: 6 }}
    >
      {suggestions.map((item) => {
        const label =
          item.kind === 'file'
            ? item.value.slice(item.value.lastIndexOf('/') + 1)
            : item.kind === 'command'
              ? `/${item.value}`
              : item.kind === 'prompt'
                ? `#${item.name}`
                : item.value
        return (
          <Pressable
            key={`${item.kind}:${item.value}`}
            accessibilityRole="button"
            accessibilityLabel={
              item.kind === 'command'
                ? `Command ${item.value}: ${item.detail}`
                : item.kind === 'prompt'
                  ? `Insert saved prompt ${item.name}`
                  : `Mention ${item.kind === 'file' ? 'file' : item.kind === 'mcp' ? 'MCP server' : 'skill'} ${item.value}`
            }
            onPress={() => {
              if (item.kind === 'prompt') {
                const prompt = prompts.find((entry) => entry.id === item.value)
                if (prompt) onChange(insertPrompt(text, mention.start, caret, prompt.text).text)
              } else if (item.kind === 'command') {
                onChange(text.slice(0, mention.start) + text.slice(caret))
                onCommand?.(item.value as ComposerCommandId)
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
