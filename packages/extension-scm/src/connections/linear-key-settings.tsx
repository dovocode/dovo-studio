import {
  clientScopeKey,
  useLinearConnections,
  useLinearKeySettings,
  useWorkspace,
} from '@dovo/studio-core'
import { projectDisplayName, type LinearConnections } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, ChoicePicker, FormField, Input } from '@dovo/studio-ui'
import { useId } from 'react'

export function LinearKeySettings() {
  const { connection, snapshot } = useWorkspace()
  return (
    <LinearSettingsForm
      key={clientScopeKey(connection)}
      connections={snapshot?.linearConnections}
    />
  )
}

function LinearSettingsForm({ connections }: { connections?: LinearConnections }) {
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
      {connections && <LinearConnectionsForm snapshot={connections} />}
    </section>
  )
}

function LinearConnectionsForm({ snapshot }: { snapshot: LinearConnections }) {
  const { request, connected, workspace } = useWorkspace()
  const uiText = useInterfaceText()
  const editor = useLinearConnections(snapshot, request)
  const disabled = !connected || editor.busy
  const projects = workspace.repositories.filter((project) => project.kind !== 'scratch')
  return (
    <div className="grid gap-3 border-t pt-3">
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!disabled && editor.name.trim() && editor.apiKey.trim()) void editor.save()
        }}
      >
        <FormField label={uiText('Named Linear connection')}>
          <ChoicePicker
            aria-label={uiText('Named Linear connection')}
            disabled={disabled}
            value={editor.edit?.id ?? ''}
            onValueChange={editor.selectConnection}
          >
            <option value="">{uiText('Add a connection')}</option>
            {editor.state.connections.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </ChoicePicker>
        </FormField>
        <FormField label={uiText('Connection name')}>
          <Input
            aria-label={uiText('Connection name')}
            maxLength={80}
            value={editor.name}
            disabled={disabled}
            onChange={(event) => editor.setName(event.target.value)}
          />
        </FormField>
        <FormField label={uiText('Connection API key')}>
          <Input
            aria-label={uiText('Connection API key')}
            type="password"
            autoComplete="new-password"
            maxLength={512}
            value={editor.apiKey}
            disabled={disabled}
            onChange={(event) => editor.setApiKey(event.target.value)}
          />
        </FormField>
        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={disabled || !editor.name.trim() || !editor.apiKey.trim()}
          >
            {uiText('Save connection')}
          </Button>
          {editor.edit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => void editor.remove()}
            >
              {uiText('Remove connection')}
            </Button>
          )}
        </div>
      </form>
      {projects.length > 0 && editor.state.connections.length > 0 && (
        <div className="grid gap-2 border-t pt-3">
          <FormField label={uiText('Project for Linear issues')}>
            <ChoicePicker
              aria-label={uiText('Project for Linear issues')}
              disabled={disabled}
              value={editor.project}
              onValueChange={editor.selectProject}
            >
              <option value="">{uiText('Select a project')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {projectDisplayName(project)}
                </option>
              ))}
            </ChoicePicker>
          </FormField>
          {editor.project && (
            <>
              <FormField label={uiText('Project Linear connection')}>
                <ChoicePicker
                  aria-label={uiText('Project Linear connection')}
                  disabled={disabled}
                  value={editor.connectionId}
                  onValueChange={editor.setConnectionId}
                >
                  <option value="">{uiText('Select a connection')}</option>
                  {editor.state.connections.map(({ id, name }) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </ChoicePicker>
              </FormField>
              <FormField label={uiText('Linear team key')}>
                <Input
                  aria-label={uiText('Linear team key')}
                  placeholder="ENG"
                  maxLength={40}
                  value={editor.team}
                  disabled={disabled}
                  onChange={(event) => editor.setTeam(event.target.value)}
                />
              </FormField>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={disabled || !editor.connectionId || !editor.team.trim()}
                  onClick={() => void editor.bind()}
                >
                  {uiText('Save project binding')}
                </Button>
                {editor.projectRevision && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void editor.unbind()}
                  >
                    {uiText('Remove project binding')}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {editor.error && (
        <p role="alert" className="text-sm">
          {editor.error}
        </p>
      )}
    </div>
  )
}
