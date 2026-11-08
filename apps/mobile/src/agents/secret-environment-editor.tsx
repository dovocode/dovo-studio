import { useState } from 'react'
import { View } from 'react-native'
import {
  decodeResult,
  agentEnvironmentNameSchema,
  defaultSecretReference,
  secretReferenceProviders,
  type AgentSecretReferences,
  type AgentSecretReference,
} from '@dovo/protocol'
import { Field } from '../ui/controls/field'
import { Choice } from '../ui/controls/choice'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

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
  const { styles } = useTheme()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState('')
  const update = (key: string, reference: AgentSecretReference) =>
    onChange({ ...value, [key]: reference })
  return (
    <View style={{ gap: 12 }}>
      <Text>Secret environment references</Text>
      <Text style={styles.muted}>
        Values are resolved on this computer at launch using its provider CLI login. A reference
        overrides a literal environment value with the same name.
      </Text>
      {Object.entries(value).map(([key, reference]) => (
        <View key={key} style={[styles.card, { gap: 8 }]}>
          <Text>{key}</Text>
          <Choice
            label={`Secret provider for ${key}`}
            value={reference.provider}
            disabled={disabled}
            items={[...secretReferenceProviders]}
            onChange={(provider) => {
              const option = secretReferenceProviders.find((item) => item.id === provider)
              if (option) update(key, defaultSecretReference(option.id))
            }}
          />
          <Field
            label={`Secret reference for ${key}`}
            value={reference.reference}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={
              reference.provider === 'onepassword'
                ? 'op://vault/item/field'
                : reference.provider === 'bitwarden'
                  ? 'Item ID'
                  : reference.provider === 'infisical'
                    ? 'SECRET_KEY'
                    : 'HOST_VARIABLE'
            }
            onChangeText={(text) => update(key, { ...reference, reference: text })}
          />
          {reference.provider === 'onepassword' && (
            <Field
              label={`1Password account for ${key}`}
              placeholder="Account (optional)"
              value={reference.account ?? ''}
              editable={!disabled}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(account) =>
                update(key, { ...reference, account: account || undefined })
              }
            />
          )}
          {reference.provider === 'bitwarden' && (
            <Choice
              label={`Bitwarden field for ${key}`}
              value={reference.field ?? 'password'}
              disabled={disabled}
              items={['password', 'username', 'totp'].map((field) => ({ id: field, name: field }))}
              onChange={(field) => {
                if (field === 'password' || field === 'username' || field === 'totp')
                  update(key, { ...reference, field })
              }}
            />
          )}
          {reference.provider === 'infisical' && (
            <>
              <Field
                label={`Infisical project for ${key}`}
                value={reference.projectId}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(projectId) => update(key, { ...reference, projectId })}
              />
              <Field
                label={`Infisical environment for ${key}`}
                value={reference.environment}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(environment) => update(key, { ...reference, environment })}
              />
              <Field
                label={`Infisical path for ${key}`}
                value={reference.path}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(path) => update(key, { ...reference, path })}
              />
              <Field
                label={`Infisical domain for ${key}`}
                placeholder="Optional; CLI default"
                value={reference.domain ?? ''}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(domain) =>
                  update(key, { ...reference, domain: domain || undefined })
                }
              />
            </>
          )}
          <Action
            secondary
            label={`Remove ${key}`}
            disabled={disabled}
            onPress={() => {
              const next = { ...value }
              delete next[key]
              onChange(next)
            }}
          />
        </View>
      ))}
      <Field
        label="New secret environment variable"
        value={name}
        placeholder="API_KEY"
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setName}
      />
      <Action
        secondary
        label="Add reference"
        disabled={disabled || Object.keys(value).length >= 64}
        onPress={() => {
          const key = name.trim()
          if (!decodeResult(agentEnvironmentNameSchema, key).success || Object.hasOwn(value, key)) {
            setError(
              'Enter a unique environment variable name. Runtime credentials cannot be referenced.',
            )
            return
          }
          onChange({ ...value, [key]: defaultSecretReference('onepassword') })
          setName('')
          setError('')
        }}
      />
      <Action
        secondary
        label="Refresh secret references"
        disabled={disabled || refreshing}
        onPress={() => {
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
      />
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!status && <Text style={styles.muted}>{status}</Text>}
    </View>
  )
}
