import { createComposerHistory } from './composer-history'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { ComposerTextarea } from '@dovo/studio-ui'
import type { ConversationPage, ResourceSettings, SavedPrompt } from '@dovo/protocol'
import { useFileMentions, type ComposerCommandId } from './file-mentions'
import type { createComposerDraft } from './composer-draft'

/** Keystrokes and caret changes stay in the editor, away from workspace and harness controls. */
export const ComposerEditor = memo(function ComposerEditor({
  controller,
  taskId,
  input,
  resources,
  prompts,
  onCommand,
  onSideChat,
  onManagePrompts,
  autoFocus,
  hidden,
  disabled,
  submitBusy,
  submittedText,
  placeholder,
  messages = [],
  onAlternativeSubmit,
  historyBefore,
  historyRevision = 0,
  historyScope,
  loadHistory,
}: {
  controller: ReturnType<typeof createComposerDraft>
  taskId: string
  input: RefObject<HTMLTextAreaElement | null>
  resources: ResourceSettings
  prompts?: readonly SavedPrompt[]
  onCommand?: (id: ComposerCommandId) => void
  onSideChat?: () => void
  onManagePrompts?: () => void
  autoFocus: boolean
  hidden: boolean
  disabled: boolean
  submitBusy: boolean
  submittedText: string | null
  messages?: readonly { role: string; text: string }[]
  onAlternativeSubmit?: () => void
  historyBefore?: string
  historyRevision?: number
  historyScope?: string
  loadHistory?: (before: string, signal: AbortSignal) => Promise<ConversationPage>
  placeholder: string
}) {
  const draft = useSyncExternalStore(
    controller.subscribe,
    () => controller.text,
    () => controller.text,
  )
  const setDraft = useCallback(
    (text: string) => {
      controller.update(text)
    },
    [controller],
  )
  const history = useRef(createComposerHistory())
  const historyCaret = useRef(false)
  const cursor = useRef(historyBefore)
  const cache = useRef(new Map<string, ConversationPage>())
  const pending = useRef<AbortController | null>(null)
  const [historyStatus, setHistoryStatus] = useState<{ busy: boolean; error: string }>({
    busy: false,
    error: '',
  })
  useEffect(() => {
    history.current.reset()
    cache.current.clear()
    pending.current?.abort()
    pending.current = null
    setHistoryStatus({ busy: false, error: '' })
    return () => {
      history.current.reset()
      pending.current?.abort()
      pending.current = null
    }
  }, [controller, taskId, historyScope, historyRevision])
  const cancelLoad = () => {
    pending.current?.abort()
    pending.current = null
    setHistoryStatus({ busy: false, error: '' })
  }
  const applyRecall = (text: string) => {
    if (text === controller.text) {
      input.current?.setSelectionRange(0, 0)
      mentions.track()
    } else {
      historyCaret.current = true
      setDraft(text)
    }
  }
  const loadOlder = async () => {
    if (!loadHistory || !cursor.current || pending.current) return
    const operation = new AbortController()
    pending.current = operation
    const generation = history.current.generation
    const draftRevision = controller.revision
    setHistoryStatus({ busy: true, error: '' })
    try {
      while (cursor.current && history.current.atOldest) {
        const before: string = cursor.current
        const cached = cache.current.get(before)
        const page: ConversationPage = cached ?? (await loadHistory(before, operation.signal))
        if (
          operation.signal.aborted ||
          history.current.generation !== generation ||
          controller.revision !== draftRevision
        )
          return
        if ((page.historyRevision ?? 0) !== historyRevision)
          throw new Error(
            'Conversation changed. Reload the thread before recalling older messages.',
          )
        // Cached pages retain only user messages; an assistant-only page is valid there.
        if (page.before === before || (!cached && !page.messages.length && page.before))
          throw new Error('History did not advance. Reload the thread before trying again.')
        cache.current.set(before, {
          ...page,
          messages: page.messages.filter((message) => message.role === 'user'),
          turns: [],
        })
        cursor.current = page.before
        history.current.appendOlder(page.messages)
      }
      if (
        operation.signal.aborted ||
        history.current.generation !== generation ||
        controller.revision !== draftRevision
      )
        return
      const recalled = history.current.move('older', controller.text, messages)
      if (recalled !== undefined) applyRecall(recalled)
    } catch (error) {
      if (
        !operation.signal.aborted &&
        history.current.generation === generation &&
        controller.revision === draftRevision
      )
        setHistoryStatus({
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        })
    } finally {
      if (pending.current === operation) {
        pending.current = null
        setHistoryStatus((value) => ({ ...value, busy: false }))
      }
    }
  }
  const mentions = useFileMentions({
    taskId,
    draft,
    setDraft,
    input,
    resources,
    prompts,
    onCommand,
    onSideChat,
    onManagePrompts,
  })
  // Place the caret with the recalled value's DOM commit, before another edit can begin.
  useLayoutEffect(() => {
    if (!historyCaret.current) return
    historyCaret.current = false
    input.current?.setSelectionRange(0, 0)
    mentions.track()
  })
  return (
    <>
      {!submitBusy && mentions.menu}
      <ComposerTextarea
        ref={input}
        autoFocus={autoFocus}
        aria-label="Message task"
        data-task-id={taskId}
        aria-autocomplete="list"
        aria-controls={mentions.open ? mentions.menuId : undefined}
        aria-activedescendant={mentions.open ? mentions.activeId : undefined}
        hidden={hidden}
        value={submitBusy && submittedText !== null && draft.trim() === submittedText ? '' : draft}
        disabled={disabled}
        readOnly={submitBusy}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          mentions.onKeyDown(event)
          if (
            !event.defaultPrevented &&
            !submitBusy &&
            event.key === 'Enter' &&
            event.altKey &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            onAlternativeSubmit
          ) {
            event.preventDefault()
            onAlternativeSubmit()
            return
          }
          if (
            event.defaultPrevented ||
            submitBusy ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return
          if (!history.current.active && event.currentTarget.selectionStart !== 0) return
          const older = event.key === 'ArrowUp'
          if (!older) cancelLoad()
          if (older && pending.current) {
            event.preventDefault()
            return
          }
          if (!history.current.active && older) cursor.current = historyBefore
          const atOldest = history.current.atOldest
          const recalled = history.current.move(
            event.key === 'ArrowUp' ? 'older' : 'newer',
            controller.text,
            messages,
          )
          if (
            older &&
            (atOldest || recalled === undefined) &&
            history.current.active &&
            cursor.current &&
            loadHistory
          ) {
            event.preventDefault()
            void loadOlder()
            return
          }
          if (recalled === undefined) {
            if (!cursor.current || !loadHistory) history.current.reset()
            return
          }
          event.preventDefault()
          applyRecall(recalled)
        }}
        onSelect={mentions.track}
        onChange={(event) => {
          cancelLoad()
          history.current.reset()
          setDraft(event.target.value)
          mentions.track()
        }}
        placeholder={placeholder}
      />
      {historyStatus.busy && (
        <p role="status" className="px-3 text-xs text-muted-foreground">
          Loading earlier messages…
        </p>
      )}
      {historyStatus.error && (
        <p role="alert" className="px-3 text-xs text-destructive">
          {historyStatus.error} Press Up to retry.
        </p>
      )}
    </>
  )
})
