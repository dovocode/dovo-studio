import { useMemo } from 'react'
import { approvalDetails, type ApprovalDetailField } from '@dovo/protocol'

function Fields({ fields }: { fields: ApprovalDetailField[] }) {
  return (
    <dl className="space-y-2.5">
      {fields.map((field, index) => (
        <div key={index} className="min-w-0">
          {field.label && (
            <dt className="mb-1 text-[0.6875rem] font-medium text-muted-foreground">
              {field.label}
            </dt>
          )}
          <dd className="m-0 min-w-0">
            {field.children?.length ? (
              <div className="border-l pl-3">
                <Fields fields={field.children} />
              </div>
            ) : (
              <div
                className={
                  field.code
                    ? 'whitespace-pre-wrap break-words rounded-md border bg-background px-2.5 py-2 font-mono text-xs [overflow-wrap:anywhere]'
                    : 'whitespace-pre-wrap break-words text-xs leading-relaxed [overflow-wrap:anywhere]'
                }
              >
                {field.text}
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function ApprovalDetails({ detail }: { detail: string }) {
  const presentation = useMemo(() => approvalDetails(detail), [detail])
  return (
    <div className="my-3 min-w-0">
      <div className="max-h-64 overflow-auto pr-1">
        <Fields fields={presentation.fields} />
      </div>
      {presentation.json && (
        <details className="mt-2 text-[0.6875rem] text-muted-foreground">
          <summary className="w-fit cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-ring">
            Full JSON
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-background p-2.5 font-mono [overflow-wrap:anywhere]">
            {presentation.raw}
          </pre>
        </details>
      )}
    </div>
  )
}
