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
import { composerCaretRecoveryKey, useAppPreferences } from '@dovo/studio-core'
import { ComposerTextarea } from '@dovo/studio-ui'
import type {
  ComposerReferenceResources,
  ConversationPage,
  ResourceSettings,
  SavedPrompt,
} from '@dovo/protocol'
import { useFileMentions, type ComposerCommandId } from './file-mentions'
import type { createComposerDraft } from './composer-draft'
import { composerSelection, selectComposerInput } from './composer-input'
import {
  loadRichComposer,
  rememberModeCaret,
  takeModeCaret,
  toggleComposerMode,
} from './composer-mode'
import { parseRichMarkdown } from './rich-markdown'
import type { RichComposerHandle, RichKeyContext } from './rich-composer-editor'

type RichEditor = (typeof import('./rich-composer-editor'))['default']
type HistoryMessage = { role: string; text: string }
/** The key fields shared by textarea and rich-editor keyboard events. */
type ComposerKey = {
  key: string
  keyCode: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  defaultPrevented: boolean
  isComposing: boolean
  preventDefault(): void
}

/** Keystrokes and caret changes stay in the editor, away from workspace and harness controls. */
export const ComposerEditor = memo(function ComposerEditor({
  controller,
  taskId,
  input,
  resources,
  provider,
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
  onInputElement,
  suggestion,
  onDismissSuggestion,
}: {
  suggestion?: string
  onDismissSuggestion?: () => void
  controller: ReturnType<typeof createComposerDraft>
  taskId: string
  input: RefObject<HTMLElement | null>
  resources: ResourceSettings & ComposerReferenceResources
  provider?: string
  prompts?: readonly SavedPrompt[]
  onCommand?: (id: ComposerCommandId) => void
  onSideChat?: () => void
  onManagePrompts?: () => void
  autoFocus: boolean
  hidden: boolean
  disabled: boolean
  submitBusy: boolean
  submittedText: string | null
  /** Recalled with Up. A getter keeps streaming replies from re-rendering the editor. */
  messages?: readonly HistoryMessage[] | (() => readonly HistoryMessage[])
  onAlternativeSubmit?: () => void
  historyBefore?: string
  historyRevision?: number
  historyScope?: string
  loadHistory?: (before: string, signal: AbortSignal) => Promise<ConversationPage>
  placeholder: string
  /**
   * The input element was replaced, as when switching modes. Focus cannot be tracked by
   * events then: React ignores the blur from removing a focused element during a commit.
   */
  onInputElement?: () => void
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
  const recallable = () => (typeof messages === 'function' ? messages() : messages)
  const { richTextComposer, sendWith } = useAppPreferences()
  const shown = submitBusy && submittedText !== null && draft.trim() === submittedText ? '' : draft
  // Rich text unless the draft holds Markdown the rich editor cannot preserve. Once a draft
  // falls back to source, it stays there until it is cleared or the mode is switched, so the
  // editor never swaps while someone is typing.
  const richCheck = richTextComposer ? parseRichMarkdown(shown) : null
  const [sourceFallback, setSourceFallback] = useState(false)
  if (richCheck && !richCheck.supported && !sourceFallback) {
    setSourceFallback(true)
    if (document.activeElement === input.current)
      rememberModeCaret(input, { start: shown.length, end: shown.length, focused: true })
  }
  if (sourceFallback && (!richTextComposer || !draft.trim())) setSourceFallback(false)
  const wantsRich = !!richCheck?.supported && !sourceFallback
  const [editorLoad, setEditorLoad] = useState<{
    editor?: RichEditor
    error?: string
    reloadError?: string
  }>({})
  const RichComposerEditor = editorLoad.editor
  const rich = wantsRich && !!RichComposerEditor
  useEffect(() => {
    if (!wantsRich) return
    let disposed = false
    void loadRichComposer()
      .then((module) => {
        if (disposed) return
        const element = input.current
        rememberModeCaret(input, {
          ...composerSelection(element, controller.text.length),
          focused: !!element && document.activeElement === element,
        })
        setEditorLoad({ editor: module.default })
      })
      .catch((cause: unknown) => {
        if (!disposed) setEditorLoad({ error: String(cause) })
      })
    return () => {
      disposed = true
    }
  }, [wantsRich, controller, input])
  const reloadEditor = () => {
    try {
      controller.flush()
      const element = input.current
      sessionStorage.setItem(
        composerCaretRecoveryKey(historyScope, taskId),
        JSON.stringify({
          ...composerSelection(element, controller.text.length),
          focused: !!element && document.activeElement === element,
        }),
      )
      window.location.reload()
    } catch (cause) {
      setEditorLoad({
        error: editorLoad.error ?? 'Rich editor unavailable.',
        reloadError: `Could not save before reloading. Keep this window open. ${String(cause)}`,
      })
    }
  }
  useLayoutEffect(() => {
    const key = composerCaretRecoveryKey(historyScope, taskId)
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return
      const caret: unknown = JSON.parse(raw)
      if (
        caret &&
        typeof caret === 'object' &&
        'start' in caret &&
        typeof caret.start === 'number' &&
        'end' in caret &&
        typeof caret.end === 'number' &&
        'focused' in caret &&
        typeof caret.focused === 'boolean'
      ) {
        if (caret.focused) input.current?.focus()
        selectComposerInput(input.current, caret.start, caret.end)
      }
      sessionStorage.removeItem(key)
    } catch (cause) {
      console.warn('Could not restore the composer caret.', cause)
    }
  }, [historyScope, taskId, input])
  const richHandle = useRef<RichComposerHandle | null>(null)
  const attachSource = useCallback(
    (element: HTMLTextAreaElement | null) => {
      input.current = element
      if (element) onInputElement?.()
    },
    [input, onInputElement],
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
      selectComposerInput(input.current, 0)
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
      const recalled = history.current.move('older', controller.text, recallable())
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
    rich: rich ? richHandle : null,
    resources,
    provider,
    prompts,
    onCommand,
    onSideChat,
    onManagePrompts,
  })
  // Place the caret with the recalled value's DOM commit, before another edit can begin.
  useLayoutEffect(() => {
    if (!historyCaret.current) return
    historyCaret.current = false
    selectComposerInput(input.current, 0)
    mentions.track()
  })
  // After switching modes, focus and the caret move to the same place in the other editor.
  useLayoutEffect(() => {
    const caret = takeModeCaret(input)
    if (!caret || !input.current) return
    if (caret.focused) input.current.focus()
    selectComposerInput(input.current, caret.start, caret.end)
    mentions.track()
  }, [rich])
  /** Keys shared by both editors: mentions, Alt+Enter, mode switching and history recall. */
  const onKey = (event: ComposerKey, context: RichKeyContext) => {
    if (event.isComposing || event.keyCode === 229) return
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'm'
    ) {
      event.preventDefault()
      toggleComposerMode(input)
      return
    }
    if (
      !draft &&
      suggestion &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      (event.key === 'Tab' || event.key === 'Escape')
    ) {
      event.preventDefault()
      if (event.key === 'Tab') controller.update(suggestion)
      onDismissSuggestion?.()
      return
    }
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
    if (!context.collapsed) return
    if (!history.current.active && !context.atStart) return
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
      recallable(),
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
  }
  const edited = (text: string) => {
    cancelLoad()
    history.current.reset()
    setDraft(text)
    mentions.track()
  }
  const attributes = {
    'aria-label': 'Message thread',
    'data-task-id': taskId,
    'aria-autocomplete': 'list' as const,
    'aria-controls': mentions.open ? mentions.menuId : undefined,
    'aria-activedescendant': mentions.open ? mentions.activeId : undefined,
  }
  const source = (
    <ComposerTextarea
      ref={attachSource}
      autoFocus={autoFocus}
      {...attributes}
      hidden={hidden}
      value={shown}
      disabled={disabled}
      readOnly={submitBusy}
      onKeyDown={(event) => {
        const { selectionStart, selectionEnd } = event.currentTarget
        onKey(
          {
            key: event.key,
            keyCode: event.keyCode,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            isComposing: event.nativeEvent.isComposing,
            get defaultPrevented() {
              return event.defaultPrevented
            },
            preventDefault: () => event.preventDefault(),
          },
          { atStart: selectionStart === 0, collapsed: selectionStart === selectionEnd },
        )
      }}
      onSelect={mentions.track}
      onChange={(event) => edited(event.target.value)}
      placeholder={placeholder}
    />
  )
  return (
    <>
      {!submitBusy && mentions.menu}
      {rich && RichComposerEditor ? (
        <RichComposerEditor
          value={shown}
          resources={resources}
          onChange={edited}
          input={input}
          handle={richHandle}
          onKeyDown={onKey}
          onSelectionChange={mentions.track}
          onMount={onInputElement}
          sendWith={sendWith}
          readOnly={submitBusy}
          disabled={disabled}
          hidden={hidden}
          autoFocus={autoFocus}
          placeholder={placeholder}
          attributes={attributes}
        />
      ) : (
        source
      )}
      {wantsRich && editorLoad.error && !hidden && (
        <div role="alert" className="px-4 pb-2 text-xs text-destructive">
          Rich editor could not load. Your Markdown source is still editable.
          <button
            type="button"
            className="ml-2 underline"
            onPointerDown={(event) => event.preventDefault()}
            onClick={reloadEditor}
          >
            Retry rich editor
          </button>
          <span className="ml-2 text-muted-foreground">
            Retry saves your draft and reloads this page.
          </span>
          {editorLoad.reloadError && <p className="mt-1">{editorLoad.reloadError}</p>}
          <span className="sr-only">{editorLoad.error}</span>
        </div>
      )}
      {richTextComposer && !rich && !wantsRich && !hidden && (
        <p role="status" className="px-4 pb-1 text-[0.6875rem] text-muted-foreground">
          Editing Markdown source.{' '}
          {richCheck && !richCheck.supported
            ? richCheck.reason
            : 'Clear the draft or switch modes to return to rich text.'}
        </p>
      )}
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
