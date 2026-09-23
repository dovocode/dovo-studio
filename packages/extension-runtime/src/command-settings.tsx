import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import {
  commandFields,
  commandSettingsResponse,
  useWorkspace,
  type CommandSettings as Settings,
} from '@dovo/studio-core'
import { Button, FormField, Input, Textarea } from '@dovo/studio-ui'
export function CommandSettings() {
  const { request, connected } = useWorkspace()
  const [settings, setSettings] = useApplicationState<Settings | null>(null)
  const [defaultShell, setDefaultShell] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [saved, setSaved] = useApplicationState(false)
  useEffect(() => {
    let stopped = false
    setSettings(null)
    setError('')
    if (connected)
      void request('/api/commands/read', {}, commandSettingsResponse)
        .then((result) => {
          if (!stopped) {
            setSettings(result.settings)
            setDefaultShell(result.defaultShell)
          }
        })
        .catch((error) => {
          if (!stopped) setError(String(error))
        })
    return () => {
      stopped = true
    }
  }, [request, connected])
  const change = (next: Settings) => {
    setSettings(next)
    setSaved(false)
  }
  return (
    <article className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Runtime host defaults. Enter executable names or paths, without shell quoting. Agent
        overrides take precedence. Changes apply to new processes.
      </p>
      {settings && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setBusy(true)
            setError('')
            setSaved(false)
            void request(
              '/api/commands/save',
              {
                ...settings,
                shellArgs: settings.shellArgs.filter(Boolean),
              },
              commandSettingsResponse,
            )
              .then((result) => {
                setSettings(result.settings)
                setSaved(true)
              })
              .catch((error) => setError(String(error)))
              .finally(() => setBusy(false))
          }}
        >
          <fieldset disabled={busy || !connected} className="grid gap-3 sm:grid-cols-2">
            {commandFields.map((field) => (
              <FormField key={field.id} label={field.label}>
                <Input
                  aria-label={field.label}
                  value={settings[field.id]}
                  placeholder={field.id === 'shell' ? defaultShell : field.placeholder}
                  onChange={(event) =>
                    change({
                      ...settings,
                      [field.id]: event.target.value,
                    })
                  }
                />
              </FormField>
            ))}
            <FormField label="Shell arguments (one per line)">
              <Textarea
                aria-label="Shell arguments"
                value={settings.shellArgs.join('\n')}
                onChange={(event) =>
                  change({
                    ...settings,
                    shellArgs: event.target.value.split('\n'),
                  })
                }
              />
            </FormField>
          </fieldset>
          <p className="text-xs text-muted-foreground">
            Automatic shell: {defaultShell}. Default argument: -l (login shell). Empty arguments use
            the shell’s normal interactive startup.
          </p>
          <Button type="submit" disabled={busy || !connected}>
            Save command settings
          </Button>
          {saved && (
            <p role="status" className="text-xs text-muted-foreground">
              Command settings saved.
            </p>
          )}
        </form>
      )}
      {!connected && (
        <p className="text-xs text-muted-foreground">Connect to configure the runtime host.</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  )
}
