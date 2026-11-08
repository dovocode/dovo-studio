import { useRef } from 'react'
import { Paperclip, Plus } from 'lucide-react'
import { Button } from '@dovo/studio-ui'
export function AttachmentPicker({
  disabled,
  upload,
  prominent = false,
}: {
  disabled: boolean
  upload: (files: File[]) => Promise<void>
  prominent?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={prominent ? 'composer-attach' : 'size-7'}
        aria-label="Attach files"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {prominent ? <Plus className="size-5" /> : <Paperclip className="size-3.5" />}
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Choose attachments"
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ''
          void upload(files)
        }}
      />
    </>
  )
}
