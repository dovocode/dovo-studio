import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { responseSelectionReply } from '@dovo/protocol'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'
import { createComposerDraft } from '../composer/composer-draft'
import { ComposerDictation } from '../composer/composer-dictation'

export function QuoteSelection({
  taskId,
  messageId,
  text,
  onQuote,
  onClose,
}: {
  taskId: string
  messageId: string
  text: string
  onQuote: (reply: string) => void
  onClose: () => void
}) {
  const id = useId()
  const [selected, setSelected] = useState('')
  const [dictating, setDictating] = useState(false)
  const [comment] = useState(() => createComposerDraft('', () => {}))
  const value = useSyncExternalStore(
    comment.subscribe,
    () => comment.text,
    () => comment.text,
  )
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => () => comment.flush(), [comment])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-full max-w-lg">
        <DialogTitle>Quote selection</DialogTitle>
        <DialogDescription>Select the text you want to quote.</DialogDescription>
        <textarea
          aria-label="Response text"
          value={text}
          readOnly
          rows={6}
          className="w-full resize-y rounded-md border bg-background p-2 text-sm"
          onSelect={({ currentTarget }) =>
            setSelected(text.slice(currentTarget.selectionStart, currentTarget.selectionEnd))
          }
        />
        <label htmlFor={id} className="text-sm">
          Comment on selected text
        </label>
        <textarea
          id={id}
          ref={input}
          value={value}
          rows={3}
          readOnly={dictating}
          onChange={(event) => comment.update(event.target.value)}
          className="w-full resize-y rounded-md border bg-background p-2 text-sm"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ComposerDictation
            taskId={taskId}
            controller={comment}
            input={input}
            transientId={id}
            disabled={!selected.trim()}
            onActive={setDictating}
          />
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected.trim() || dictating}
            onClick={() => {
              onQuote(responseSelectionReply(messageId, selected, comment.text))
              onClose()
            }}
          >
            Add quote to draft
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
