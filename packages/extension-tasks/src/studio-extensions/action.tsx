import { DataSource, useVisibleStudioSource } from '../dashboards/data-source'
import { ExtensionSourceAccess } from './source-access'
import { lazy, Suspense, useState } from 'react'
import {
  isStudioDataSource,
  type ExtensionContribution,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import {
  callStudioExtension,
  readExtensionDataSource,
  openStudioExtension,
  useStudioSourcePolicy,
  useStudioAutoLoad,
  useStudioHost,
  useWorkspace,
} from '@dovo/studio-core'

const McpAppView = lazy(async () => ({ default: (await import('../chat/mcp-app')).McpAppView }))
const control = 'rounded-md border px-3 py-2 text-sm disabled:opacity-50'

export function ExtensionAction({
  entry,
  contribution,
  focused,
}: {
  entry: StudioExtensionEntry
  contribution: Exclude<ExtensionContribution, { kind: 'view' }>
  focused?: boolean
}) {
  const { request, connected, snapshot } = useWorkspace()
  const host = useStudioHost()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { host: sourceHost, visible, canRead } = useVisibleStudioSource()
  const policy = useStudioSourcePolicy(
    request,
    connected &&
      !!snapshot?.studioSourcePoliciesSupported &&
      (contribution.kind === 'app' || contribution.kind === 'tool'),
    ['extension', entry.id],
    entry.revision,
    contribution.id,
  )
  useStudioAutoLoad(connected && visible, !!policy.policy?.autoLoad, () => {
    if (canRead()) void activate(true)
  })
  async function activate(automatic = false) {
    if (open) {
      if (!automatic) setOpen(false)
      return
    }
    if (busy) return
    setBusy(true)
    setError('')
    setResult('')
    try {
      if (contribution.kind === 'tool') {
        setResult(
          JSON.stringify(
            (await callStudioExtension(request, entry, contribution.id, automatic)).data,
            null,
            2,
          ),
        )
      } else {
        const { contribution: opened } = await openStudioExtension(
          request,
          entry,
          contribution.id,
          automatic,
        )
        if (opened.kind === 'studio')
          host.navigate({
            viewId: opened.destination === 'terminal' ? 'terminals' : opened.destination,
          })
        else if (opened.kind === 'app') setOpen(true)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (isStudioDataSource(contribution))
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">{contribution.title}</p>
        <DataSource
          owner={['extension', entry.id]}
          revision={entry.revision}
          source={contribution}
          read={(automatic) => readExtensionDataSource(request, entry, contribution.id, automatic)}
        />
      </div>
    )

  return (
    <div ref={sourceHost} className="space-y-2">
      {snapshot?.studioSourcePoliciesSupported &&
        (contribution.kind === 'tool' || contribution.kind === 'app') && (
          <ExtensionSourceAccess
            policy={policy}
            title={
              contribution.kind === 'tool'
                ? `${entry.installed?.name ?? entry.id} · ${contribution.server} · ${contribution.tool}`
                : contribution.title
            }
            app={contribution.kind === 'app'}
          />
        )}
      <button
        autoFocus={focused}
        className={control}
        disabled={
          !connected ||
          busy ||
          (contribution.kind === 'tool' &&
            !!snapshot?.studioSourcePoliciesSupported &&
            (!policy.policy || policy.policy.access === 'off'))
        }
        onClick={() => void activate()}
      >
        {open ? 'Close app' : busy ? 'Running…' : contribution.title}
      </button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {result && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{result}</pre>
      )}
      {open && connected && contribution.kind === 'app' && (
        <Suspense fallback={<p>Loading app…</p>}>
          <McpAppView
            extension={
              snapshot?.studioSourcePoliciesSupported
                ? { id: entry.id, contributionId: contribution.id }
                : undefined
            }
            reference={{
              id: contribution.appId,
              taskId: contribution.taskId,
              title: contribution.title,
            }}
          />
        </Suspense>
      )}
    </div>
  )
}
