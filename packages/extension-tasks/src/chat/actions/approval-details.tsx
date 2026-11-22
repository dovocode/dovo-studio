import { useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { approvalDetails, type ApprovalDetailField } from '@dovo/protocol'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import { useInterfaceText } from '@dovo/studio-core/interface-language'

function CodePreview({ text, label, raw = false }: { text: string; label: string; raw?: boolean }) {
  const uiText = useInterfaceText()
  const [status, setStatus] = useState('')
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-background" data-approval-preview>
      <div className="flex items-center justify-between gap-2 border-b px-2.5 py-1">
        <span className="text-xs font-medium text-muted-foreground">{raw ? 'JSON' : label}</span>
        <div className="flex items-center gap-2">
          {status && (
            <span role="status" className="text-xs text-muted-foreground">
              {status}
            </span>
          )}
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={uiText('Copy')}
            title={uiText('Copy')}
            onClick={() =>
              void copyTextToClipboard(text).then(
                () => setStatus(uiText('Copied')),
                () => setStatus(uiText('Could not copy')),
              )
            }
          >
            {status === uiText('Copied') ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      <pre
        role="region"
        aria-label={label}
        tabIndex={0}
        data-approval-json={raw || undefined}
        className="m-0 max-h-[min(27dvh,12rem)] overflow-auto whitespace-pre-wrap px-2.5 py-2.5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring"
      >
        {text}
      </pre>
    </div>
  )
}

function Fields({ fields }: { fields: ApprovalDetailField[] }) {
  return (
    <dl className="space-y-2.5">
      {fields.map((field, index) => (
        <div key={index} className="min-w-0">
          {field.label && (
            <dt
              className={
                field.code ? 'sr-only' : 'mb-0.5 text-xs font-medium text-muted-foreground'
              }
            >
              {field.label}
            </dt>
          )}
          <dd className="m-0 min-w-0">
            {field.children?.length ? (
              <div className="border-l pl-3">
                <Fields fields={field.children} />
              </div>
            ) : field.code ? (
              <CodePreview text={field.text ?? ''} label={field.label} />
            ) : (
              <div className="whitespace-pre-wrap text-xs leading-relaxed [overflow-wrap:anywhere]">
                {field.text}
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ApprovalDetails({ detail, bounded = true }: { detail: string; bounded?: boolean }) {
  const presentation = useMemo(() => approvalDetails(detail), [detail])
  return (
    <div className="min-w-0 space-y-2" data-approval-preview>
      <div className={bounded ? 'max-h-[min(42dvh,22rem)] overflow-auto' : undefined}>
        <Fields fields={presentation.fields} />
      </div>
      {presentation.json && (
        <details className="text-xs text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-ring">
            Full JSON
          </summary>
          <div className="mt-1">
            <CodePreview text={presentation.raw} label="Full JSON" raw />
          </div>
        </details>
      )}
    </div>
  )
}
