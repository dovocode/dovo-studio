import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react'
import { Schema } from 'effect'
import { FileText, Hash, Plug, Settings2, Sparkles, SquareSlash } from 'lucide-react'
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
import { useWorkspace } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'

const filesSchema = mutableStruct({ files: mutableArray(Schema.String) })
type Suggestion = {
  kind: 'file' | 'skill' | 'mcp' | 'command' | 'prompt'
  /** Prompt suggestions: shown name, while `detail` previews the text. */
  name?: string
  value: string
  detail?: string
  muted?: boolean
}
export type ComposerCommandId = ReturnType<typeof commandSuggestions>[number]['id']
const icons = { file: FileText, skill: Sparkles, mcp: Plug, command: SquareSlash, prompt: Hash }

/** Composer mentions like other agent apps: "@" for files and MCP servers, "$" for skills
 * anywhere, and "/" for skills at the start of a line. Arrow keys and Enter or Tab pick;
 * Escape dismisses. */
export function useFileMentions({
  taskId,
  draft,
  setDraft,
  input,
  resources,
  onCommand,
  prompts = [],
  onManagePrompts,
}: {
  taskId: string
  draft: string
  setDraft: (value: string) => void
  input: RefObject<HTMLTextAreaElement | null>
  resources: ResourceSettings
  /** Runs a built-in "/" command; its text is removed from the draft. */
  onCommand?: (id: ComposerCommandId) => void
  /** The project's saved prompts, inserted with "#". */
  prompts?: readonly SavedPrompt[]
  onManagePrompts?: () => void
}) {
  const { request, connected } = useWorkspace()
  const [caret, setCaret] = useState(0)
  const [files, setFiles] = useState<string[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const mention = composerMention(draft, caret)
  const trigger = mention?.trigger
  const query = mention?.query
  const resourceItems: Suggestion[] = mention
    ? resourceSuggestions(resources, mention.trigger, mention.query).map((item) => ({
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
    mention?.trigger === '/' && onCommand
      ? commandSuggestions(mention.query).map((command) => ({
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
  const suggestions: Suggestion[] = [
    ...promptItems,
    ...commandItems,
    ...resourceItems,
    ...(trigger === '@' ? files.map((path) => ({ kind: 'file' as const, value: path })) : []),
  ]
  // A bare "#" always opens, so the saved prompts editor stays one keystroke away.
  const managing = mention?.trigger === '#' && !!onManagePrompts
  const open =
    !!mention &&
    dismissed !== mention.start &&
    (suggestions.length > 0 || (managing && !mention.query))
  useEffect(() => {
    if (trigger !== '@' || query === undefined || !connected) {
      setFiles([])
      return
    }
    let disposed = false
    const timer = setTimeout(() => {
      void request('/api/tasks/files', { id: taskId, query }, filesSchema).then(
        (result) => {
          if (disposed) return
          setFiles(result.files)
        },
        () => {
          if (!disposed) setFiles([])
        },
      )
    }, 120)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [trigger, query, taskId, connected, request])
  useEffect(() => setActive(0), [trigger, query])
  const track = () => setCaret(input.current?.selectionStart ?? draft.length)
  const choose = (item: Suggestion | undefined) => {
    if (!mention || !item) return
    if (item.kind === 'prompt') {
      const prompt = prompts.find((entry) => entry.id === item.value)
      if (!prompt) return
      const next = insertPrompt(draft, mention.start, caret, prompt.text)
      setDraft(next.text)
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.setSelectionRange(next.caret, next.caret)
        setCaret(next.caret)
      })
      return
    }
    if (item.kind === 'command') {
      const text = draft.slice(0, mention.start) + draft.slice(caret)
      setDraft(text)
      setFiles([])
      requestAnimationFrame(() => {
        input.current?.focus()
        input.current?.setSelectionRange(mention.start, mention.start)
        setCaret(mention.start)
      })
      onCommand?.(item.value as ComposerCommandId)
      return
    }
    const next = insertMention(draft, mention.start, caret, item.value, mention.trigger)
    setDraft(next.text)
    setFiles([])
    requestAnimationFrame(() => {
      input.current?.focus()
      input.current?.setSelectionRange(next.caret, next.caret)
      setCaret(next.caret)
    })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((index) => (index + step + suggestions.length) % suggestions.length)
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
      role="listbox"
      aria-label={
        trigger === '@'
          ? 'Files and MCP servers'
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
            : item.kind === 'command'
              ? `/${item.value}`
              : item.kind === 'prompt'
                ? `#${item.name}`
                : item.value
        const detail =
          item.kind === 'file' ? (slash > 0 ? item.value.slice(0, slash) : '') : item.detail
        return (
          <button
            key={`${item.kind}:${item.value}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
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
  return { onKeyDown, track, menu, open }
}
