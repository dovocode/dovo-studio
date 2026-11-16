import type { ReactNode } from 'react'
import { Checkbox, FormField, Textarea } from '@dovo/studio-ui'
import {
  MAX_PROBLEM_REPORT_TEXT,
  type ProblemReportForm,
  type ProblemReportInclude,
  type ProblemReportPreview,
} from '@dovo/protocol'

const includeOptions: readonly {
  key: keyof ProblemReportInclude
  label: string
  detail: string
}[] = [
  {
    key: 'versions',
    label: 'App and runtime versions',
    detail: 'Versions, operating system and the Git commit of the runtime.',
  },
  {
    key: 'diagnostics',
    label: 'Runtime diagnostics and logs',
    detail: 'Health summary and the newest runtime log lines, limited to 64 KB.',
  },
  {
    key: 'clientErrors',
    label: 'Recent app errors',
    detail: 'Errors this window recorded since it opened.',
  },
]

export function ReportProblemFields({
  form,
  onChange,
  disabled,
  clientErrors,
  children,
}: {
  form: ProblemReportForm
  onChange: (form: ProblemReportForm) => void
  disabled: boolean
  /** Number of app errors that would be included. */
  clientErrors: number
  /** Computer and agent controls. */
  children?: ReactNode
}) {
  return (
    <div className="grid gap-4">
      <FormField label="What happened? (required)">
        <Textarea
          aria-required="true"
          autoFocus
          rows={4}
          maxLength={MAX_PROBLEM_REPORT_TEXT}
          placeholder="Describe what you did and what went wrong."
          value={form.description}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
        />
      </FormField>
      <FormField label="What did you expect? (optional)">
        <Textarea
          rows={2}
          maxLength={MAX_PROBLEM_REPORT_TEXT}
          value={form.expected}
          disabled={disabled}
          onChange={(event) => onChange({ ...form, expected: event.target.value })}
        />
      </FormField>
      {children}
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs font-medium text-muted-foreground">Include</legend>
        {includeOptions.map((option) => (
          <label key={option.key} className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={form.include[option.key]}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({ ...form, include: { ...form.include, [option.key]: checked === true } })
              }
            />
            <span className="grid gap-0.5">
              <span>
                {option.label}
                {option.key === 'clientErrors' ? ` (${clientErrors})` : ''}
              </span>
              <span className="text-xs text-muted-foreground">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  )
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/** Exactly what the runtime will send: the first message and the attached file. */
export function ReportProblemPreviewView({ preview }: { preview: ProblemReportPreview }) {
  const block =
    'max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-mono text-xs'
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        {preview.redactions
          ? `The runtime hid ${preview.redactions} ${preview.redactions === 1 ? 'value' : 'values'} that looked like credentials, environment values or user names.`
          : 'The runtime found no credentials, environment values or user names to hide.'}{' '}
        The agent receives this text and nothing else from this form.
      </p>
      <section className="grid gap-2" aria-label="First message">
        <h3 className="text-xs font-medium text-muted-foreground">First message</h3>
        <pre className={block}>{preview.message}</pre>
      </section>
      {preview.attachment ? (
        <section className="grid gap-2" aria-label="Attached file">
          <h3 className="text-xs font-medium text-muted-foreground">
            Attached file: {preview.attachment.name} · {formatBytes(preview.attachment.bytes)}
          </h3>
          <pre className={block}>{preview.attachment.text}</pre>
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">No file is attached.</p>
      )}
    </div>
  )
}
