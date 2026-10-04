import { useRef, useState } from 'react'
import { Button, MessageResponse, Textarea } from '@dovo/studio-ui'

export function PullMarkdownEditor({
  value,
  onChange,
  disabled,
  baseURL,
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  baseURL: string
}) {
  const [preview, setPreview] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const insert = (before: string, after: string, placeholder: string) => {
    const element = input.current
    if (!element) return
    const start = element.selectionStart
    const end = element.selectionEnd
    const text = value.slice(start, end) || placeholder
    onChange(value.slice(0, start) + before + text + after + value.slice(end))
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + before.length, start + before.length + text.length)
    })
  }
  return (
    <div className="overflow-hidden rounded-xl border focus-within:border-primary">
      <div
        className="flex flex-wrap gap-1 border-b bg-muted/30 p-2"
        aria-label="Markdown formatting"
      >
        <Button
          type="button"
          size="sm"
          variant={!preview ? 'secondary' : 'ghost'}
          aria-pressed={!preview}
          disabled={disabled}
          onClick={() => setPreview(false)}
        >
          Write
        </Button>
        <Button
          type="button"
          size="sm"
          variant={preview ? 'secondary' : 'ghost'}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Preview
        </Button>
        {!preview &&
          (
            [
              ['Heading', '### ', '', 'Heading'],
              ['Bold', '**', '**', 'text'],
              ['Italic', '_', '_', 'text'],
              ['Quote', '> ', '', 'quote'],
              ['Code', '`', '`', 'code'],
              ['Link', '[', '](https://example.com)', 'label'],
              ['List', '- ', '', 'item'],
              ['Task list', '- [ ] ', '', 'task'],
            ] as const
          ).map(([label, before, after, placeholder]) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => insert(before, after, placeholder)}
            >
              {label}
            </Button>
          ))}
      </div>
      {preview ? (
        <div className="min-h-40 p-4 text-sm">
          <MessageResponse baseURL={baseURL}>{value || 'Nothing to preview.'}</MessageResponse>
        </div>
      ) : (
        <Textarea
          ref={input}
          aria-label="PR action body"
          className="min-h-40 rounded-none border-0 shadow-none focus-visible:ring-0"
          value={value}
          disabled={disabled}
          maxLength={60000}
          placeholder="Leave feedback on this pull request…"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}
