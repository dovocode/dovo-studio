import { nativeEffect } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { decodeResult } from '@dovo/protocol'
import { useEffect } from 'react'
import { View } from 'react-native'
import { Schema, Effect } from 'effect'
import { cliProfileOptions, runClientEffect } from '@dovo/client-runtime'
import {
  forgeCliProfileQuerySchema,
  forgeCliProfilesSchema,
  type ForgeProvider,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
export function CliProfilePicker({
  provider,
  baseUrl,
  cliTool,
  connectionId,
  value,
  onChange,
  disabled,
}: {
  provider: ForgeProvider
  baseUrl: string
  cliTool?: 'fj' | 'tea'
  connectionId?: string
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  const { read, connected, snapshot, readEffect } = useRuntime()
  const repositories = snapshot?.workspace.repositories ?? []
  const [repositoryId, setRepositoryId] = useApplicationState(
    () =>
      repositories.find((repo) => connectionId && repo.forge?.connectionId === connectionId)?.id ??
      '',
  )
  const [result, setResult] = useApplicationState<
    Schema.Schema.Type<typeof forgeCliProfilesSchema> | undefined
  >(undefined)
  const [loading, setLoading] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [revision, reload] = useApplicationState(0)
  const [manual, setManual] = useApplicationState(false)
  useEffect(() => {
    let current = true
    setResult(undefined)
    setError('')
    setLoading(false)
    if (!connected) return
    const query = decodeResult(forgeCliProfileQuerySchema, {
      provider,
      baseUrl: baseUrl.trim(),
      cliTool,
      repositoryId: repositoryId || undefined,
    })
    if (!query.success) return
    setLoading(true)
    const timer = setTimeout(() => {
      void runClientEffect(
        readEffect('/api/scm/cli-profiles/read', query.data, forgeCliProfilesSchema)
          .pipe(
            Effect.flatMap((value) =>
              nativeEffect(() => {
                if (current) setResult(value)
              }),
            ),
          )
          .pipe(
            Effect.catchAll((error: unknown) =>
              nativeEffect(() => {
                if (current) setError(error instanceof Error ? error.message : String(error))
              }),
            ),
          )
          .pipe(
            Effect.ensuring(
              nativeEffect(() => {
                if (current) setLoading(false)
              }).pipe(Effect.orDie),
            ),
          ),
      )
    }, 300)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [read, connected, provider, baseUrl, cliTool, repositoryId, revision])
  const optional = provider === 'github' || provider === 'azure-devops' || cliTool === 'fj'
  const label = provider === 'azure-devops' ? 'CLI tenant' : 'CLI profile'
  return (
    <View
      style={{
        gap: 10,
      }}
    >
      <Choice
        row
        label="Discover in"
        value={repositoryId}
        onChange={setRepositoryId}
        disabled={disabled}
        items={[
          {
            id: '',
            name: 'Runtime default',
          },
          ...repositories.map((repo) => ({
            id: repo.id,
            name: `${repo.name} · Project checkout`,
          })),
        ]}
      />
      {!manual && (
        <Choice
          row
          label={label}
          value={value}
          onChange={onChange}
          disabled={disabled || loading}
          items={cliProfileOptions(
            result?.profiles ?? [],
            value,
            optional ? 'CLI default' : 'Choose profile',
          )}
        />
      )}
      {(manual || (!loading && !result?.profiles.length)) && (
        <Field
          label={optional ? `${label} (optional)` : `Named ${label.toLowerCase()}`}
          value={value}
          onChangeText={onChange}
          editable={!disabled}
          autoCorrect={false}
          placeholder={
            provider === 'bitbucket' ? 'default' : optional ? 'Use the CLI default' : 'work'
          }
        />
      )}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Action
          secondary
          label={loading ? 'Finding profiles…' : 'Refresh profiles'}
          disabled={disabled || loading || !connected}
          onPress={() => reload((value) => value + 1)}
        />
        {(loading || !!result?.profiles.length) && (
          <Action
            secondary
            label={manual ? 'Choose detected profile' : 'Enter profile manually'}
            disabled={disabled}
            onPress={() => setManual((value) => !value)}
          />
        )}
      </View>
      {!!(error || result?.message) && (
        <Text style={styles.muted}>
          {error || result?.message}
          {error ? ' Enter a profile manually or refresh after signing in on the runtime.' : ''}
        </Text>
      )}
    </View>
  )
}
