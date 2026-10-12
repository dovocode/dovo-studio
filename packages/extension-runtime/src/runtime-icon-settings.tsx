import {
  runtimeIconChoices,
  runtimePreferencesSchema,
  type RuntimeOverview,
  type RuntimeIcon as IconName,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Button } from '@dovo/studio-ui'
import { RuntimeIcon } from '@dovo/studio-ui/runtime-icon'

export function RuntimeIconSettings({ source }: { source: RuntimeOverview }) {
  const { readRuntime, refreshRuntime } = useWorkspace()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const supported = source.snapshot?.runtimeIcon !== undefined
  const save = async (runtimeIcon: IconName) => {
    setBusy(true)
    setError('')
    try {
      await readRuntime(
        source.profile,
        '/api/runtime/preferences/save',
        { runtimeIcon },
        runtimePreferencesSchema,
      )
      await refreshRuntime(source.profile)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-2" aria-label="Computer icon">
      <h2 className="text-sm font-medium">Computer icon</h2>
      <p className="text-xs text-muted-foreground">
        Saved on this computer and shared with paired devices.
      </p>
      <div className="flex flex-wrap gap-2">
        {runtimeIconChoices.map(({ id, name }) => (
          <Button
            key={id}
            size="sm"
            variant={id === (source.snapshot?.runtimeIcon ?? 'desktop') ? 'secondary' : 'outline'}
            aria-pressed={id === (source.snapshot?.runtimeIcon ?? 'desktop')}
            disabled={busy || !source.connected || !supported}
            onClick={() => void save(id)}
          >
            <RuntimeIcon icon={id} className="size-4" />
            {name}
          </Button>
        ))}
      </div>
      {!supported && (
        <p className="text-xs text-muted-foreground">Update this runtime to customize its icon.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
