import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Schema } from 'effect'
import { FileText, Hash, Plug, Settings2, Sparkles, SquareSlash } from 'lucide-react'
import {
  modelMentionsSchema,
  insertModelMention,
  type ModelMention,
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
import { cn } from '@dovo/studio-ui'
import { sameWorkspaceFields, useAppPreferences, useWorkspaceSelector } from '@dovo/studio-core'
import { composerSelection, selectComposerInput } from './composer-input'
import { selectConversationConnection } from '../thread/workspace-selection'
import type { RichComposerHandle } from './rich-composer-editor'

const filesSchema = mutableStruct({ files: mutableArray(Schema.String) })
type Suggestion = {
  kind: 'file' | 'skill' | 'mcp' | 'command' | 'prompt' | 'model'
  /** Prompt suggestions: shown name, while `detail` previews the text. */
  name?: string
  value: string
  detail?: string
  muted?: boolean
}
export type ComposerCommandId = Exclude<ReturnType<typeof commandSuggestions>[number]['id'], 'goal'>
const icons = {
  file: FileText,
  skill: Sparkles,
  mcp: Plug,
  command: SquareSlash,
  prompt: Hash,
  model: Sparkles,
}
type MentionKey = {
  key: string
  keyCode: number
  preventDefault(): void
  nativeEvent?: { isComposing: boolean }
  isComposing?: boolean
}

/** Composer mentions like other agent apps: "@" for files and MCP servers, "$" for skills
 * anywhere, and "/" for skills at the start of a line. Arrow keys and Enter or Tab pick;
 * Escape dismisses. */
export function useFileMentions({
  taskId,
  draft,
  setDraft,
  input,
  rich,
  resources,
  provider,
  onCommand,
  onSideChat,
  prompts = [],
  onManagePrompts,
}: {
  taskId: string
  draft: string
  setDraft: (value: string) => void
  input: RefObject<HTMLElement | null>
  /** In rich mode, mentions use the text before the caret in the current block. */
  rich?: RefObject<RichComposerHandle | null> | null
  resources: ResourceSettings
  provider?: string
  /** Runs a built-in "/" command; its text is removed from the draft. */
  onCommand?: (id: ComposerCommandId) => void
  onSideChat?: () => void
  /** The project's saved prompts, inserted with "#". */
  prompts?: readonly SavedPrompt[]
  onManagePrompts?: () => void
}) {
  // Streaming and terminal updates replace the workspace; lookups need only the connection.
  const { request, connected, connection } = useWorkspaceSelector(
    selectConversationConnection,
    sameWorkspaceFields,
  )
  const modelMentionsSupported = useWorkspaceSelector(
    (state) => state.snapshot?.modelMentionsSupported === true,
  )
  const [modelLookup, setModelLookup] = useState<{
    key: string
    models: ModelMention[]
    error: string
  }>()
  const [caret, setCaret] = useState(0)
  const [richText, setRichText] = useState('')
  const source = rich ? richText : draft
  const [lookup, setLookup] = useState<{ key: string; files: string[]; error: string }>()
  const [retry, setRetry] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const [activeKey, setActiveKey] = useState('')
  const [dismissed, setDismissed] = useState<number | null>(null)
  const { showSkillsInSlashMenu } = useAppPreferences()
  const mention = composerMention(source, caret)
  const trigger = mention?.trigger
  const query = mention?.query
  const resourceItems: Suggestion[] = mention
    ? resourceSuggestions(resources, mention.trigger, mention.query)
        .filter((item) => mention.trigger !== '/' || showSkillsInSlashMenu || item.kind !== 'skill')
        .map((item) => ({
          kind: item.kind,
          value: item.name,
          detail:
            item.kind === 'mcp'
              ? 'MCP server'
              : item.enabled
                ? item.description
                : `Not enabled · added to this message only${item.description ? ` · ${item.description}` : ''}`,
          muted: !item.enabled,
        }))
    : []
  const commandItems: Suggestion[] =
    mention?.trigger === '/'
      ? [
          ...commandSuggestions(mention.query, provider).filter(
            (item) => item.id === 'goal' || onCommand,
          ),
          ...(onSideChat && 'sidechat'.startsWith(mention.query.toLowerCase())
            ? [
                {
                  id: 'sidechat',
                  description: 'Open side chats or start an agent side chat from the draft',
                },
              ]
            : []),
        ].map((command) => ({
          kind: 'command' as const,
          value: command.id,
          detail: command.description,
        }))
      : []
  const promptItems: Suggestion[] =
    mention?.trigger === '#'
      ? promptSuggestions(prompts, mention.query).map((prompt) => ({
          kind: 'prompt' as const,
          value: prompt.id,
          name: prompt.name,
          detail: prompt.text.replace(/\s+/g, ' ').slice(0, 120),
        }))
      : []
  const lookupKey = JSON.stringify([
    taskId,
    connection?.address,
    connection?.token,
    trigger,
    query,
    connected,
    retry,
  ])
  const files = lookup?.key === lookupKey ? lookup.files : []
  const lookupError = lookup?.key === lookupKey ? lookup.error : ''
  const modelError =
    modelMentionsSupported && modelLookup?.key === lookupKey ? modelLookup.error : ''
  const searching = trigger === '@' && connected && lookup?.key !== lookupKey
  const suggestions: Suggestion[] = [
    ...(modelMentionsSupported && modelLookup?.key === lookupKey
      ? modelLookup.models.map((model) => ({
          kind: 'model' as const,
          value: model.reference,
          name: model.name,
          detail: `${model.provider} · ${model.model}`,
        }))
      : []),
    ...promptItems,
    ...commandItems,
    ...resourceItems,
    ...(trigger === '@' ? files.map((path) => ({ kind: 'file' as const, value: path })) : []),
  ]
  const itemKey = (item: Suggestion) => `${item.kind}:${item.value}`
  const active = Math.max(
    0,
    suggestions.findIndex((item) => itemKey(item) === activeKey),
  )
  // A bare "#" always opens, so the saved prompts editor stays one keystroke away.
  const managing = mention?.trigger === '#' && !!onManagePrompts
  const open =
    !!mention &&
    dismissed !== mention.start &&
    (suggestions.length > 0 ||
      searching ||
      !!lookupError ||
      !!modelError ||
      (managing && !mention.query))
  useEffect(() => {
    if (trigger !== '@' || query === undefined || !connected) {
      setLookup(undefined)
      return
    }
    let disposed = false
    const timer = setTimeout(() => {
      void request('/api/tasks/files', { id: taskId, query }, filesSchema).then(
        (result) => {
          if (disposed) return
          setLookup({ key: lookupKey, files: result.files, error: '' })
        },
        (cause: unknown) => {
          if (!disposed)
            setLookup({
              key: lookupKey,
              files: [],
              error: cause instanceof Error ? cause.message : String(cause),
            })
        },
      )
    }, 120)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [trigger, query, taskId, connected, request, lookupKey])
  useEffect(() => {
    if (trigger !== '@' || !query || query.length < 2 || !connected || !modelMentionsSupported)
      return
    let stopped = false
    const timer = setTimeout(() => {
      void request('/api/agents/model-mentions', { taskId, query }, modelMentionsSchema).then(
        (result) => {
          if (!stopped)
            setModelLookup({
              key: lookupKey,
              models: result.models,
              error: result.unavailable.length
                ? `Models unavailable: ${result.unavailable.join(', ')}`
                : '',
            })
        },
        (cause: unknown) => {
          if (!stopped) setModelLookup({ key: lookupKey, models: [], error: String(cause) })
        },
      )
    }, 180)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [trigger, query, connected, modelMentionsSupported, request, taskId, lookupKey])
  useEffect(() => setActiveKey(''), [trigger, query])
  useEffect(() => {
    if (open)
      list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeKey, lookup, modelLookup, trigger, query])
  const track = () => {
    if (rich) {
      const context = rich.current?.mentionContext()
      setRichText(context?.text ?? '')
      setCaret(context?.caret ?? 0)
    } else setCaret(composerSelection(input.current, draft.length).start)
  }
  /** Replace the typed mention; rich mode inserts at the caret instead of rewriting the draft. */
  const apply = (next: { text: string; caret: number }, markdown = false) => {
    if (!mention) return
    if (rich) {
      rich.current?.replaceBeforeCaret(
        mention.start,
        caret,
        next.text.slice(mention.start, next.caret),
        markdown,
      )
      track()
      return
    }
    setDraft(next.text)
    requestAnimationFrame(() => {
      input.current?.focus()
      selectComposerInput(input.current, next.caret)
      setCaret(next.caret)
    })
  }
  const choose = (item: Suggestion | undefined) => {
    if (!mention || !item) return
    if (item.kind === 'model') {
      apply(insertModelMention(source, mention.start, caret, item.value), true)
      return
    }
    if (item.kind === 'prompt') {
      const prompt = prompts.find((entry) => entry.id === item.value)
      if (!prompt) return
      // Saved prompts are Markdown and keep their formatting in rich mode.
      apply(insertPrompt(source, mention.start, caret, prompt.text), true)
      return
    }
    if (item.kind === 'command') {
      setLookup(undefined)
      if (item.value === 'goal') {
        apply(insertMention(source, mention.start, caret, 'goal', '/'))
        return
      }
      apply({
        text: source.slice(0, mention.start) + source.slice(caret),
        caret: mention.start,
      })
      if (item.value === 'sidechat') onSideChat?.()
      else onCommand?.(item.value as ComposerCommandId)
      return
    }
    setLookup(undefined)
    apply(insertMention(source, mention.start, caret, item.value, mention.trigger))
  }
  const onKeyDown = (event: MentionKey) => {
    if (!open || event.nativeEvent?.isComposing || event.isComposing || event.keyCode === 229)
      return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      if (suggestions.length)
        setActiveKey(
          itemKey(suggestions[(active + step + suggestions.length) % suggestions.length]),
        )
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      choose(suggestions[active] ?? suggestions[0])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setDismissed(mention?.start ?? null)
    }
  }
  const menu = open ? (
    <div
      ref={list}
      id={menuId}
      role="listbox"
      aria-label={
        trigger === '@'
          ? 'Files, models and MCP servers'
          : trigger === '/'
            ? 'Commands and skills'
            : trigger === '#'
              ? 'Saved prompts'
              : 'Skills'
      }
      className="absolute bottom-full left-2 right-2 z-20 mb-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {suggestions.map((item, index) => {
        const Icon = icons[item.kind]
        const slash = item.kind === 'file' ? item.value.lastIndexOf('/') : -1
        const label =
          item.kind === 'file'
            ? item.value.slice(slash + 1)
            : item.kind === 'model'
              ? item.name
              : item.kind === 'command'
                ? `/${item.value}`
                : item.kind === 'prompt'
                  ? `#${item.name}`
                  : item.value
        const detail =
          item.kind === 'file' ? (slash > 0 ? item.value.slice(0, slash) : '') : item.detail
        return (
          <button
            key={itemKey(item)}
            id={`${menuId}-${index}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveKey(itemKey(item))}
            onClick={() => choose(item)}
            className={cn(
              'flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs',
              index === active && 'bg-accent/55',
              item.muted && 'opacity-70',
            )}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-medium">{label}</span>
            {detail && <span className="min-w-0 truncate text-muted-foreground">{detail}</span>}
          </button>
        )
      })}
      {modelError && (
        <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
          {modelError}
        </p>
      )}
      {searching && (
        <p role="status" className="px-2 py-1.5 text-xs text-muted-foreground">
          Searching files…
        </p>
      )}
      {lookupError && (
        <div role="alert" className="px-2 py-1.5 text-xs text-destructive">
          <p>{lookupError}</p>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry file search
          </button>
        </div>
      )}
      {managing && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setDismissed(mention?.start ?? null)
            onManagePrompts?.()
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/55"
        >
          <Settings2 className="size-3.5" />
          {prompts.length ? 'Manage saved prompts…' : 'No saved prompts yet · Add one…'}
        </button>
      )}
    </div>
  ) : null
  return {
    menuId,
    activeId: suggestions[active] ? `${menuId}-${active}` : undefined,
    onKeyDown,
    track,
    menu,
    open,
  }
}
