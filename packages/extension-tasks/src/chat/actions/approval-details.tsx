import { useMemo, useState } from 'react'
import { Braces, Check, Copy } from 'lucide-react'
import {
  approvalDetails,
  approvalVisibleText,
  type ApprovalDetailField,
  type approvalActions,
  type ApprovalDecision,
} from '@dovo/protocol'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button } from '@dovo/studio-ui'

function CodePreview({ text, label, raw = false }: { text: string; label: string; raw?: boolean }) {
  const uiText = useInterfaceText()
  const [status, setStatus] = useState('')
  return (
    <div className="min-w-0 rounded-lg border bg-background">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/25 px-2.5 py-0.5">
        <span className="min-w-0 break-words text-xs font-medium text-muted-foreground">
          {raw ? 'JSON' : approvalVisibleText(label)}
        </span>
        <div className="flex items-center gap-2">
          {status && (
            <span role="status" className="text-xs text-muted-foreground">
              {status}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0 text-muted-foreground"
            aria-label={uiText('Copy {value0}', { value0: label })}
            title={uiText('Copy {value0}', { value0: label })}
            onClick={() =>
              void copyTextToClipboard(text).then(
                () => setStatus(uiText('Copied')),
                () => setStatus(uiText('Could not copy')),
              )
            }
          >
            {status === uiText('Copied') ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </div>
      </div>
      <pre
        role="region"
        aria-label={label}
        tabIndex={0}
        data-approval-json={raw || undefined}
        className={`m-0 whitespace-pre-wrap px-2.5 py-2 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${raw ? '' : 'max-h-[min(26dvh,10rem)] overflow-auto'}`}
      >
        {approvalVisibleText(text)}
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
              {approvalVisibleText(field.label)}
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
                {approvalVisibleText(field.text ?? '')}
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ApprovalDetails({ detail, fill = false }: { detail: string; fill?: boolean }) {
  const uiText = useInterfaceText()
  const presentation = useMemo(() => approvalDetails(detail), [detail])
  const [showJson, setShowJson] = useState(false)
  const raw = showJson && presentation.json
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-approval-preview>
      <div
        key={raw ? 'json' : 'fields'}
        className={`min-h-0 overflow-auto overscroll-contain py-2.5 ${fill ? 'flex-1 px-4' : 'max-h-[min(35dvh,16rem)] px-3'}`}
      >
        {raw ? (
          <CodePreview text={presentation.raw} label={uiText('Full JSON')} raw />
        ) : (
          <Fields fields={presentation.fields} />
        )}
      </div>
      {presentation.json && (
        <div className="shrink-0 px-2 pb-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground aria-pressed:bg-primary/10 aria-pressed:text-foreground"
            aria-pressed={raw}
            onClick={() => setShowJson(!raw)}
          >
            <Braces size={13} aria-hidden="true" />
            {uiText('Full JSON')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function ApprovalButtons({
  actions,
  disabled,
  onDecision,
  compact = false,
}: {
  actions: ReturnType<typeof approvalActions>
  disabled: boolean
  onDecision: (decision: ApprovalDecision) => void
  compact?: boolean
}) {
  const uiText = useInterfaceText()
  const immediate = actions.filter(({ decision }) => decision === 'approve' || decision === 'deny')
  const scoped = actions.filter(({ decision }) => decision === 'session' || decision === 'always')
  const button = ({ decision, label }: (typeof actions)[number]) => (
    <Button
      key={decision}
      size="sm"
      className="h-auto min-h-8 min-w-0 whitespace-normal text-center [overflow-wrap:anywhere]"
      variant={decision === 'approve' ? 'default' : 'outline'}
      disabled={disabled}
      onClick={() => onDecision(decision)}
    >
      {uiText(label)}
      {decision === 'approve' || decision === 'deny' ? (
        <kbd aria-hidden="true" className="shrink-0 text-[0.625rem]">
          {decision === 'approve' ? 'Y / Enter' : 'N'}
        </kbd>
      ) : null}
    </Button>
  )
  const layout = compact ? 'grid grid-flow-col auto-cols-fr gap-2' : 'flex flex-wrap gap-2'
  return (
    <div className={compact ? 'space-y-2' : 'flex flex-wrap justify-between gap-2'}>
      <div className={layout}>{immediate.map(button)}</div>
      {scoped.length > 0 && <div className={layout}>{scoped.map(button)}</div>}
    </div>
  )
}
