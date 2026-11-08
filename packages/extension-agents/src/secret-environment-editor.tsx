import { useState } from 'react'
import {
  decodeResult,
  agentEnvironmentNameSchema,
  defaultSecretReference,
  secretReferenceProviders,
  type AgentSecretReferences,
  type AgentSecretReference,
} from '@dovo/protocol'
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dovo/studio-ui'

export function SecretEnvironmentEditor({
  value = {},
  onChange,
  onRefresh,
  disabled,
}: {
  value?: AgentSecretReferences
  onChange: (value: AgentSecretReferences) => void
  onRefresh: () => Promise<void>
  disabled?: boolean
}) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState('')
  const update = (key: string, reference: AgentSecretReference) =>
    onChange({ ...value, [key]: reference })
  return (
    <section className="space-y-3" aria-label="Secret environment references">
      <p className="text-xs font-medium">Secret environment references</p>
      <p className="text-xs text-muted-foreground">
        Store references here. Values are resolved on this computer at launch using its provider CLI
        login. A reference overrides a literal environment value with the same name.
      </p>
      {Object.entries(value).map(([key, reference]) => (
        <div key={key} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs">{key}</code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                const next = { ...value }
                delete next[key]
                onChange(next)
              }}
            >
              Remove {key}
            </Button>
          </div>
          <Select
            value={reference.provider}
            disabled={disabled}
            onValueChange={(provider) => {
              const option = secretReferenceProviders.find((item) => item.id === provider)
              if (option) update(key, defaultSecretReference(option.id))
            }}
          >
            <SelectTrigger aria-label={`Secret provider for ${key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {secretReferenceProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={`Secret reference for ${key}`}
            value={reference.reference}
            disabled={disabled}
            placeholder={
              reference.provider === 'onepassword'
                ? 'op://vault/item/field'
                : reference.provider === 'bitwarden'
                  ? 'Item ID'
                  : reference.provider === 'infisical'
                    ? 'SECRET_KEY'
                    : 'HOST_VARIABLE'
            }
            onChange={(event) => update(key, { ...reference, reference: event.target.value })}
          />
          {reference.provider === 'onepassword' && (
            <Input
              aria-label={`1Password account for ${key}`}
              placeholder="Account (optional)"
              value={reference.account ?? ''}
              disabled={disabled}
              onChange={(event) =>
                update(key, { ...reference, account: event.target.value || undefined })
              }
            />
          )}
          {reference.provider === 'bitwarden' && (
            <Select
              value={reference.field ?? 'password'}
              disabled={disabled}
              onValueChange={(field) => {
                if (field === 'password' || field === 'username' || field === 'totp')
                  update(key, { ...reference, field })
              }}
            >
              <SelectTrigger aria-label={`Bitwarden field for ${key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['password', 'username', 'totp'].map((field) => (
                  <SelectItem key={field} value={field}>
                    {field}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {reference.provider === 'infisical' && (
            <>
              <Input
                aria-label={`Infisical project for ${key}`}
                placeholder="Project ID"
                value={reference.projectId}
                disabled={disabled}
                onChange={(event) => update(key, { ...reference, projectId: event.target.value })}
              />
              <Input
                aria-label={`Infisical environment for ${key}`}
                placeholder="Environment (e.g. dev)"
                value={reference.environment}
                disabled={disabled}
                onChange={(event) => update(key, { ...reference, environment: event.target.value })}
              />
              <Input
                aria-label={`Infisical path for ${key}`}
                placeholder="Secret folder (e.g. /backend)"
                value={reference.path}
                disabled={disabled}
                onChange={(event) => update(key, { ...reference, path: event.target.value })}
              />
              <Input
                aria-label={`Infisical domain for ${key}`}
                placeholder="Domain (optional; CLI default)"
                value={reference.domain ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  update(key, { ...reference, domain: event.target.value || undefined })
                }
              />
            </>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Input
          className="min-w-0 flex-1"
          aria-label="New secret environment variable"
          value={name}
          placeholder="API_KEY"
          disabled={disabled}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled || Object.keys(value).length >= 64}
          onClick={() => {
            const key = name.trim()
            if (
              !decodeResult(agentEnvironmentNameSchema, key).success ||
              Object.hasOwn(value, key)
            ) {
              setError(
                'Enter a unique environment variable name. Runtime credentials cannot be referenced.',
              )
              return
            }
            onChange({ ...value, [key]: defaultSecretReference('onepassword') })
            setName('')
            setError('')
          }}
        >
          Add reference
        </Button>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || refreshing}
        onClick={() => {
          setRefreshing(true)
          setError('')
          setStatus('')
          void onRefresh()
            .then(() => setStatus('References will be read again on the next launch.'))
            .catch((cause: unknown) =>
              setError(cause instanceof Error ? cause.message : String(cause)),
            )
            .finally(() => setRefreshing(false))
        }}
      >
        Refresh secret references
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </section>
  )
}
