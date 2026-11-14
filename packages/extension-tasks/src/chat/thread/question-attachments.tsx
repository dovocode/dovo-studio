import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useRef } from 'react'
import type { Attachment } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { Paperclip } from 'lucide-react'
import { useAttachments } from '../composer/use-attachments'

export function QuestionAttachments({
  taskId,
  questionId,
  files,
  count,
  disabled,
  onAdd,
  onRemove,
  onBusy,
}: {
  taskId: string
  questionId: string
  files: Attachment[]
  count: number
  disabled: boolean
  onAdd: (file: Attachment) => boolean
  onRemove: (id: string) => void
  onBusy: (busy: boolean) => void
}) {
  const uiText = useInterfaceText()

  const input = useRef<HTMLInputElement>(null)
  const attachments = useAttachments({ id: taskId }, undefined, {
    key: questionId,
    files,
    count,
    uploaded: onAdd,
    remove: onRemove,
  })
  useEffect(() => {
    onBusy(attachments.busy)
    return () => onBusy(false)
  }, [attachments.busy])
  return (
    <div
      className="space-y-1"
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files)
        if (disabled || !files.length) return
        event.preventDefault()
        void attachments.upload(files)
      }}
    >
      <input
        ref={input}
        aria-label="Choose answer files"
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          if (files.length) void attachments.upload(files)
        }}
      />
      {files.map((file) => (
        <div key={file.id} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate" title={file.name}>
            {file.name}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void attachments.remove(file.id)}
            aria-label={`Remove ${file.name}`}
          >
            {uiText('Remove')}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Attach files to answer"
        className="h-7 gap-1.5 px-1 text-[0.6875rem] text-muted-foreground"
        disabled={disabled || count >= 5}
        onClick={() => input.current?.click()}
      >
        <Paperclip className="size-3" />
        {attachments.busy ? 'Attaching…' : 'Attach files'}
      </Button>
      {attachments.error && (
        <p role="alert" className="text-xs text-destructive">
          {attachments.error}
        </p>
      )}
      {attachments.editor}
    </div>
  )
}
