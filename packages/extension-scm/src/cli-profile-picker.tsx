import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  cliProfileOptions,
  forgeCliProfileQuerySchema,
  forgeCliProfilesSchema,
  useWorkspace,
  type ForgeProvider,
} from '@dovo/studio-core'
import { Button, ChoicePicker, FormField, Input } from '@dovo/studio-ui'

export function CliProfilePicker({
  provider,
  baseUrl,
  cliTool,
  connectionId,
  initialRepositoryId,
  value,
  onChange,
  disabled,
}: {
  provider: ForgeProvider
  baseUrl: string
  cliTool?: 'fj' | 'tea'
  connectionId?: string
  initialRepositoryId?: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const { request, connected, workspace } = useWorkspace()
  const [repositoryId, setRepositoryId] = useState(
    () =>
      workspace.repositories.find(
        (repo) => connectionId && repo.forge?.connectionId === connectionId,
      )?.id ??
      initialRepositoryId ??
      '',
  )
  const [result, setResult] = useState<z.infer<typeof forgeCliProfilesSchema>>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, reload] = useState(0)
  const [manual, setManual] = useState(false)
  useEffect(() => {
    let current = true
    setResult(undefined)
    setError('')
    setLoading(false)
    if (!connected) return
    const query = forgeCliProfileQuerySchema.safeParse({
      provider,
      baseUrl: baseUrl.trim(),
      cliTool,
      repositoryId: repositoryId || undefined,
    })
    if (!query.success) return
    setLoading(true)
    const timer = setTimeout(() => {
      void request('/api/scm/cli-profiles/read', query.data, forgeCliProfilesSchema)
        .then((value) => {
          if (current) setResult(value)
        })
        .catch((error: unknown) => {
          if (current) setError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (current) setLoading(false)
        })
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [request, connected, provider, baseUrl, cliTool, repositoryId, revision])
  const optional = provider === 'github' || provider === 'azure-devops' || cliTool === 'fj'
  const label = provider === 'azure-devops' ? 'CLI tenant' : 'CLI profile'
  const items = cliProfileOptions(
    result?.profiles ?? [],
    value,
    optional ? 'CLI default' : 'Choose profile',
  )
  return (
    <div className="grid gap-3">
      <FormField label="Discover profiles in">
        <ChoicePicker
          aria-label="CLI project context"
          value={repositoryId}
          onValueChange={setRepositoryId}
          disabled={disabled}
        >
          <option value="">Runtime default</option>
          {workspace.repositories.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.name} · Project checkout
            </option>
          ))}
        </ChoicePicker>
      </FormField>
      {!manual && (
        <FormField label={label}>
          <ChoicePicker
            aria-label={label}
            value={value}
            onValueChange={onChange}
            disabled={disabled || loading}
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </ChoicePicker>
        </FormField>
      )}
      {(manual || (!loading && !result?.profiles.length)) && (
        <FormField label={optional ? `${label} (optional)` : `Named ${label.toLowerCase()}`}>
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            required={!optional}
            placeholder={
              provider === 'bitbucket' ? 'default' : optional ? 'Use the CLI default' : 'work'
            }
            autoCapitalize="off"
            spellCheck={false}
          />
        </FormField>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || loading || !connected}
          onClick={() => reload((value) => value + 1)}
        >
          {loading ? 'Finding profiles…' : 'Refresh profiles'}
        </Button>
        {(loading || !!result?.profiles.length) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setManual((value) => !value)}
          >
            {manual ? 'Choose detected profile' : 'Enter profile manually'}
          </Button>
        )}
      </div>
      {(error || result?.message) && (
        <p
          role={error ? 'status' : undefined}
          className="text-xs text-muted-foreground break-words"
        >
          {error || result?.message}
          {error ? ' Enter a profile manually or refresh after signing in on the runtime.' : ''}
        </p>
      )}
    </div>
  )
}
