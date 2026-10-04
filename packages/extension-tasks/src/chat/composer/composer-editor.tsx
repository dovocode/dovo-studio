import { useAppPreferences } from '@dovo/studio-core'
import { memo, useCallback, useSyncExternalStore, type RefObject } from 'react'
import { PromptInputTextarea, MessageResponse, cn } from '@dovo/studio-ui'
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
  placeholder: string
}) {
  const { markdownComposerPreview } = useAppPreferences()
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
      {!hidden && markdownComposerPreview && draft.trim() && (
        <div
          aria-label="Formatted message preview"
          className="max-h-40 overflow-y-auto border-b px-4 py-3 text-sm"
        >
          <MessageResponse>{draft}</MessageResponse>
        </div>
      )}
      {!submitBusy && mentions.menu}
      <PromptInputTextarea
        ref={input}
        autoFocus={autoFocus}
        aria-label="Message task"
        data-task-id={taskId}
        aria-autocomplete="list"
        aria-expanded={mentions.open && !submitBusy}
        className={cn('min-h-24 max-h-64 px-4 pt-4 pb-2', hidden && 'hidden')}
        value={submitBusy && submittedText !== null && draft.trim() === submittedText ? '' : draft}
        disabled={disabled}
        readOnly={submitBusy}
        onKeyDown={mentions.onKeyDown}
        onSelect={mentions.track}
        onChange={(event) => {
          setDraft(event.target.value)
          mentions.track()
        }}
        placeholder={placeholder}
      />
    </>
  )
})
