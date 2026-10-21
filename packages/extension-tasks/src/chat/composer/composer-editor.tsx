import { createComposerHistory } from './composer-history'
import { memo, useCallback, useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { ComposerTextarea } from '@dovo/studio-ui'
import type { ResourceSettings, SavedPrompt } from '@dovo/protocol'
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
  onManagePrompts,
  autoFocus,
  hidden,
  disabled,
  submitBusy,
  submittedText,
  placeholder,
  messages = [],
  onAlternativeSubmit,
}: {
  controller: ReturnType<typeof createComposerDraft>
  taskId: string
  input: RefObject<HTMLTextAreaElement | null>
  resources: ResourceSettings
  prompts?: readonly SavedPrompt[]
  onCommand?: (id: ComposerCommandId) => void
  onManagePrompts?: () => void
  autoFocus: boolean
  hidden: boolean
  disabled: boolean
  submitBusy: boolean
  submittedText: string | null
  messages?: readonly { role: string; text: string }[]
  onAlternativeSubmit?: () => void
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
  useEffect(() => history.current.reset(), [controller, taskId])
  const mentions = useFileMentions({
    taskId,
    draft,
    setDraft,
    input,
    resources,
    prompts,
    onCommand,
    onManagePrompts,
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
          mentions.onKeyDown(event)
          if (
            !event.defaultPrevented &&
            !submitBusy &&
            !event.nativeEvent.isComposing &&
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
            event.nativeEvent.isComposing ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
          )
            return
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return
          if (!history.current.active && event.currentTarget.selectionStart !== 0) return
          const recalled = history.current.move(
            event.key === 'ArrowUp' ? 'older' : 'newer',
            controller.text,
            messages,
          )
          if (recalled === undefined) return
          event.preventDefault()
          setDraft(recalled)
          requestAnimationFrame(() => {
            input.current?.setSelectionRange(0, 0)
            mentions.track()
          })
        }}
        onSelect={mentions.track}
        onChange={(event) => {
          history.current.reset()
          setDraft(event.target.value)
          mentions.track()
        }}
        placeholder={placeholder}
      />
    </>
  )
})
