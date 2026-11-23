import { DataSource } from '../dashboards/data-source'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Disclosure,
} from '@dovo/studio-ui'
import { ExtensionMarketplace } from './marketplace'
import { ExtensionComponents, ExtensionSettingsConflicts } from './components'
import { lazy, Suspense, useState } from 'react'
import {
  decode,
  isStudioDataSource,
  runtimeComputerName,
  studioExtensionManifestSchema,
  type ExtensionContribution,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import {
  callStudioExtension,
  readExtensionDataSource,
  openStudioExtension,
  clientScopeKey,
  useStudioExtensions,
  useSettingsDraft,
  useConfirmSettingsNavigation,
  useExtensionSettingsDraft,
  extensionComponentVersion,
  studioExtensionPageTarget,
  useStudioHost,
  useWorkspace,
  WorkspaceScope,
  type StudioViewProps,
  type SaveExtensionSettings,
} from '@dovo/studio-core'

const McpAppView = lazy(async () => ({ default: (await import('../chat/mcp-app')).McpAppView }))
const control = 'rounded-md border px-3 py-2 text-sm disabled:opacity-50'
const item = 'space-y-3 rounded-lg border bg-card p-4'

export default function ExtensionsView({ entityId }: StudioViewProps) {
  const { activeRuntimeId, runtimes } = useWorkspace()
  const [owner, setOwner] = useState(activeRuntimeId ?? '')
  const confirmNavigation = useConfirmSettingsNavigation()
  const sources = runtimes.filter((entry) => entry.snapshot?.studioExtensionsSupported)
  const source = sources.find((entry) => entry.profile.id === owner) ?? sources[0]
  return (
    <section className="h-full overflow-auto p-5">
      <h1 className="mb-4 text-xl font-semibold">Studio extensions</h1>
      {source ? (
        <>
          <label className="mb-4 flex items-center gap-2 text-sm">
            Computer
            <select
              className={control}
              value={source.profile.id}
              onChange={async (event) => {
                const id = event.currentTarget.value
                if (await confirmNavigation()) setOwner(id)
              }}
            >
              {sources.map((entry) => (
                <option key={entry.profile.id} value={entry.profile.id}>
                  {runtimeComputerName(entry)}
                </option>
              ))}
            </select>
          </label>
          <WorkspaceScope key={clientScopeKey(source.profile.connection)} profile={source.profile}>
            <ExtensionList focus={entityId} />
          </WorkspaceScope>
        </>
      ) : (
        <p>Update a paired computer to manage Studio extensions.</p>
      )}
    </section>
  )
}

function ExtensionList({ focus }: { focus?: string }) {
  const { request, connected, snapshot, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  const state = useStudioExtensions(
    request,
    connected,
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const [marketplace, setMarketplace] = useState({ focus, open: focus === 'marketplace' })
  if (focus !== marketplace.focus) setMarketplace({ focus, open: focus === 'marketplace' })
  const [source, setSource] = useState('')
  useSettingsDraft(!!source.trim(), !!source.trim() && state.busy)
  const [error, setError] = useState('')
  const [review, setReview] = useState<StudioExtensionEntry>()
  const reviewChanged =
    review && state.entries.find((entry) => entry.id === review.id)?.revision !== review.revision
  async function stage() {
    try {
      const manifest = decode(studioExtensionManifestSchema, JSON.parse(source))
      if (!snapshot?.studioDataSourcesSupported && manifest.contributions.some(isStudioDataSource))
        throw new Error('Update the paired computer to use extension data sources.')
      if (
        !snapshot?.studioExtensionPinnedPages &&
        manifest.contributions.some(
          (contribution) => contribution.kind === 'view' && contribution.placement === 'page',
        )
      )
        throw new Error('Update the paired computer to use extension pages.')
      const current = state.entries.find((entry) => entry.id === manifest.id)
      setError('')
      if (
        await state.change({ action: 'stage', manifest, expectedRevision: current?.revision ?? 0 })
      )
        setSource('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <div className="max-w-4xl space-y-4">
      {!connected && <p role="status">Computer offline.</p>}
      {(error || state.error) && (
        <p role="alert" className="text-destructive">
          {error || state.error}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={state.allowAgentInstall}
          disabled={!connected || !state.loaded || state.busy}
          onChange={(event) =>
            void state.change({ action: 'agent-install-policy', enabled: event.target.checked })
          }
        />
        Allow agents to install their own extensions on this computer
      </label>
      {snapshot?.studioExtensionMarketplaceSupported && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMarketplace({ focus, open: !marketplace.open })}
          >
            {marketplace.open ? 'Close marketplace' : 'Browse extension marketplace'}
          </Button>
          {marketplace.open && (
            <ExtensionMarketplace
              entries={state.entries}
              busy={state.busy || !state.loaded}
              stage={state.change}
              review={setReview}
            />
          )}
        </>
      )}
      <details className={item}>
        <summary className="cursor-pointer">Add extension manifest</summary>
        <textarea
          aria-label="Extension manifest JSON"
          className={`${control} min-h-36 w-full font-mono`}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
        <button
          className={control}
          disabled={!connected || state.busy || !source.trim()}
          onClick={() => void stage()}
        >
          Stage manifest
        </button>
      </details>
      <button
        className={control}
        disabled={!connected || state.busy}
        onClick={() => void state.load()}
      >
        Reload extensions
      </button>
      {state.entries.map((entry) => {
        const save: SaveExtensionSettings = (settings) => state.saveSettings(entry, settings)
        return (
          <section
            key={entry.id}
            className={item}
            aria-current={focus?.split('/')[0] === entry.id ? 'true' : undefined}
          >
            <div>
              <h2 className="font-semibold">
                {entry.installed?.name ?? entry.draft?.name ?? entry.id}
              </h2>
              <p className="text-sm text-muted-foreground">
                {entry.id} · {entry.enabled ? 'Enabled' : entry.installed ? 'Disabled' : 'Draft'}
              </p>
              {entry.error && <p role="alert">{entry.error}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {entry.draft && (
                <>
                  <button
                    className={control}
                    disabled={!connected || state.busy}
                    onClick={() => setReview(entry)}
                  >
                    Review draft
                  </button>
                  <button
                    className={control}
                    disabled={!connected || state.busy}
                    onClick={() =>
                      void state.change({
                        action: 'discard',
                        id: entry.id,
                        expectedRevision: entry.revision,
                      })
                    }
                  >
                    Discard draft
                  </button>
                </>
              )}
              {entry.installed && (
                <button
                  className={control}
                  disabled={!connected || state.busy}
                  onClick={() =>
                    void state.change({
                      action: entry.enabled ? 'disable' : 'enable',
                      id: entry.id,
                      expectedRevision: entry.revision,
                    })
                  }
                >
                  {entry.enabled ? 'Disable extension' : 'Enable extension'}
                </button>
              )}
              {entry.canRollback && (
                <button
                  className={control}
                  disabled={!connected || state.busy}
                  onClick={() =>
                    void state.change({
                      action: 'rollback',
                      id: entry.id,
                      expectedRevision: entry.revision,
                    })
                  }
                >
                  Restore previous version
                </button>
              )}
              <button
                className={control}
                disabled={!connected || state.busy}
                onClick={() => {
                  if (window.confirm(`Remove ${entry.id} from this computer?`))
                    void state.change({
                      action: 'remove',
                      id: entry.id,
                      expectedRevision: entry.revision,
                    })
                }}
              >
                Remove extension
              </button>
            </div>
            <ExtensionSettings entry={entry} disabled={!connected || state.busy} save={save} />
            {entry.enabled &&
              entry.installed?.contributions.map((contribution) =>
                contribution.kind === 'view' && contribution.placement === 'page' ? (
                  <Button
                    key={contribution.id}
                    size="sm"
                    variant="outline"
                    disabled={!activeRuntimeId}
                    onClick={() => {
                      if (activeRuntimeId)
                        host.navigate(
                          studioExtensionPageTarget(activeRuntimeId, entry.id, contribution.id),
                        )
                    }}
                  >
                    {contribution.title}
                  </Button>
                ) : contribution.kind === 'view' ? (
                  <Disclosure
                    key={contribution.id}
                    title={contribution.title}
                    open={
                      contribution.placement === 'settings' ||
                      focus === `${entry.id}/${contribution.id}` ||
                      undefined
                    }
                  >
                    <ExtensionComponents entry={entry} contribution={contribution} save={save} />
                  </Disclosure>
                ) : (
                  <ExtensionAction
                    key={JSON.stringify(contribution)}
                    entry={entry}
                    contribution={contribution}
                    focused={focus === `${entry.id}/${contribution.id}`}
                  />
                ),
              )}
          </section>
        )
      })}
      {review && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !state.busy) setReview(undefined)
          }}
        >
          <DialogContent>
            <DialogTitle>Review proposed manifest</DialogTitle>
            <DialogDescription>{review.draft?.name}</DialogDescription>
            {reviewChanged && (
              <p role="alert">This draft changed. Close this review and open the new draft.</p>
            )}
            {state.error && (
              <p role="alert" className="text-destructive">
                {state.error}
              </p>
            )}
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(review.draft, null, 2)}
            </pre>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={state.busy}
                data-dialog-cancel
                onClick={() => setReview(undefined)}
              >
                Cancel
              </Button>
              <Button
                disabled={!connected || state.busy || reviewChanged}
                onClick={async () => {
                  if (
                    await state.change({
                      action: 'install',
                      id: review.id,
                      expectedRevision: review.revision,
                    })
                  )
                    setReview((current) => (current === review ? undefined : current))
                }}
              >
                Install draft
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function ExtensionSettings({
  entry,
  disabled,
  save,
}: {
  entry: StudioExtensionEntry
  disabled: boolean
  save: SaveExtensionSettings
}) {
  const {
    values: settings,
    dirty,
    conflicts,
    resolveConflicts,
    edit,
    commit,
    saving,
    error,
  } = useExtensionSettingsDraft(entry, save)
  useSettingsDraft(dirty, saving)
  const fields = entry.installed?.settings
  if (!fields?.length) return null
  return (
    <details className="space-y-2 rounded border p-3">
      <summary>{entry.installed?.name} settings</summary>
      {fields.map((field) => (
        <label key={field.id} className="flex items-center gap-2 text-sm">
          {field.title}
          {typeof field.default === 'boolean' ? (
            <input
              type="checkbox"
              disabled={disabled || saving}
              checked={settings[field.id] === true}
              onChange={(event) => edit(field.id, event.target.checked)}
            />
          ) : (
            <input
              className={control}
              maxLength={4096}
              disabled={disabled || saving}
              value={String(settings[field.id] ?? field.default)}
              onChange={(event) => edit(field.id, event.target.value)}
            />
          )}
        </label>
      ))}
      <ExtensionSettingsConflicts
        conflicts={conflicts}
        resolveConflicts={resolveConflicts}
        busy={saving}
      />
      <button
        className={control}
        disabled={disabled || saving || !dirty || conflicts.length > 0}
        onClick={() => void commit()}
      >
        Save extension settings
      </button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </details>
  )
}

export function ExtensionTile({ id, contributionId }: { id: string; contributionId: string }) {
  const { request, connected, snapshot } = useWorkspace()
  const state = useStudioExtensions(
    request,
    connected && snapshot?.studioExtensionsSupported === true,
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const entry = state.entries.find((entry) => entry.id === id && entry.enabled)
  const contribution =
    entry && entry.installed?.contributions.find((item) => item.id === contributionId)
  if (contribution?.kind === 'view' && entry)
    return (
      <div className="space-y-2 p-3">
        {!connected && <p role="status">Computer offline.</p>}
        <ExtensionComponents
          key={`${entry.id}/${contribution.id}`}
          entry={entry}
          contribution={contribution}
          save={(settings) => state.saveSettings(entry, settings)}
        />
      </div>
    )
  if (
    !entry ||
    !contribution ||
    contribution.kind === 'view' ||
    (!connected && !isStudioDataSource(contribution))
  )
    return (
      <div className="space-y-2 p-3 text-sm">
        <p role="status">{state.error || 'This extension contribution is unavailable.'}</p>
        <button className={control} disabled={!connected} onClick={() => void state.load()}>
          Reload extension
        </button>
      </div>
    )
  return (
    <div className="p-3">
      <ExtensionAction
        key={JSON.stringify([entry.id, contribution])}
        entry={entry}
        contribution={contribution}
      />
    </div>
  )
}

function ExtensionAction({
  entry,
  contribution,
  focused,
}: {
  entry: StudioExtensionEntry
  contribution: Exclude<ExtensionContribution, { kind: 'view' }>
  focused?: boolean
}) {
  const { request, connected } = useWorkspace()
  const host = useStudioHost()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function activate() {
    if (open) {
      setOpen(false)
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
            (await callStudioExtension(request, entry, contribution.id)).data,
            null,
            2,
          ),
        )
      } else {
        const { contribution: opened } = await openStudioExtension(request, entry, contribution.id)
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
          source={contribution}
          read={() => readExtensionDataSource(request, entry, contribution.id)}
        />
      </div>
    )

  return (
    <div className="space-y-2">
      <button
        autoFocus={focused}
        className={control}
        disabled={!connected || busy}
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
