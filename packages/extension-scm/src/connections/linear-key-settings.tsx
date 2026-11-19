import { useLinearKeySettings, useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, Input } from '@dovo/studio-ui'
import { useId } from 'react'

export function LinearKeySettings() {
  const { snapshot, connected, request } = useWorkspace()
  const settings = useLinearKeySettings(snapshot?.linearKeySource, request)
  const uiText = useInterfaceText()
  const keyInput = useId()
  if (settings.source === undefined) return null
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h3 className="text-sm font-semibold">Linear</h3>
      <p className="text-sm text-muted-foreground">
        {settings.source === 'saved'
          ? uiText('A Linear API key is saved on this computer.')
          : settings.source === 'environment'
            ? uiText('This computer uses a Linear API key from its environment.')
            : uiText('Add a read-only Linear API key to browse issues.')}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (connected) void settings.change('save')
        }}
      >
        <div className="min-w-40 flex-1">
          <label htmlFor={keyInput} className="block text-sm">
            {uiText('Linear API key')}
          </label>
          <Input
            id={keyInput}
            value={settings.key}
            onChange={(event) => settings.setKey(event.target.value)}
            type="password"
            autoComplete="new-password"
            maxLength={512}
            disabled={!connected || settings.busy}
          />
        </div>
        <Button type="submit" disabled={!connected || settings.busy || !settings.key.trim()}>
          {settings.source === 'saved' ? uiText('Replace key') : uiText('Save key')}
        </Button>
        {settings.source === 'saved' && (
          <Button
            type="button"
            variant="outline"
            disabled={!connected || settings.busy}
            onClick={() => void settings.change('remove')}
          >
            {uiText('Remove key')}
          </Button>
        )}
      </form>
      {settings.message && (
        <p role="status" className="text-sm">
          {settings.message}
        </p>
      )}
      {settings.error && (
        <p role="alert" className="text-sm">
          {settings.error}
        </p>
      )}
    </section>
  )
}
