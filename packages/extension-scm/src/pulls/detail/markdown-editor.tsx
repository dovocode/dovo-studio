import { useRef, useState } from 'react'
import { Button, IconButton, MessageResponse, Textarea } from '@dovo/studio-ui'
import { Heading, Bold, Italic, Quote, Code, Link, List, ListTodo } from 'lucide-react'

export function PullMarkdownEditor({
  value,
  onChange,
  disabled,
  baseURL,
  placeholder = 'Leave feedback on this pull request…',
}: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  baseURL: string
  placeholder?: string
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-2">
        <div className="flex shrink-0 gap-1" aria-label="Editor mode">
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
        </div>
        {!preview && (
          <div
            role="toolbar"
            aria-label="Markdown formatting"
            className="flex min-w-0 gap-0.5 overflow-x-auto"
          >
            {(
              [
                ['Heading', '### ', '', 'Heading', Heading],
                ['Bold', '**', '**', 'text', Bold],
                ['Italic', '_', '_', 'text', Italic],
                ['Quote', '> ', '', 'quote', Quote],
                ['Code', '`', '`', 'code', Code],
                ['Link', '[', '](https://example.com)', 'label', Link],
                ['List', '- ', '', 'item', List],
                ['Task list', '- [ ] ', '', 'task', ListTodo],
              ] as const
            ).map(([label, before, after, placeholder, Icon]) => (
              <IconButton
                key={label}
                label={label}
                type="button"
                className="size-7 shrink-0"
                disabled={disabled}
                onClick={() => insert(before, after, placeholder)}
              >
                <Icon size={14} />
              </IconButton>
            ))}
          </div>
        )}
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
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  )
}
