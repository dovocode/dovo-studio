import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [status, setStatus] = useState('')
  const update = (key: string, reference: AgentSecretReference) =>
    onChange({ ...value, [key]: reference })
  return (
    <View style={{ gap: 12 }}>
      <Text>
        <InterfaceText>{'Secret environment references'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Values are resolved on this computer at launch using its provider CLI login. A reference overrides a literal environment value with the same name.'
          }
        </InterfaceText>
      </Text>
      {Object.entries(value).map(([key, reference]) => (
        <View key={key} style={[styles.card, { gap: 8 }]}>
          <Text>{key}</Text>
          <Choice
            label={uiText('Secret provider for {value0}', { value0: key })}
            value={reference.provider}
            disabled={disabled}
            items={[...secretReferenceProviders]}
            onChange={(provider) => {
              const option = secretReferenceProviders.find((item) => item.id === provider)
              if (option) update(key, defaultSecretReference(option.id))
            }}
          />
          <Field
            label={uiText('Secret reference for {value0}', { value0: key })}
            value={reference.reference}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={
              reference.provider === 'onepassword'
                ? uiText('op://vault/item/field')
                : reference.provider === 'bitwarden'
                  ? uiText('Item ID')
                  : reference.provider === 'infisical'
                    ? 'SECRET_KEY'
                    : 'HOST_VARIABLE'
            }
            onChangeText={(text) => update(key, { ...reference, reference: text })}
          />
          {reference.provider === 'onepassword' && (
            <Field
              label={uiText('1Password account for {value0}', { value0: key })}
              placeholder={uiText('Account (optional)')}
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
              label={uiText('Bitwarden field for {value0}', { value0: key })}
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
                label={uiText('Infisical project for {value0}', { value0: key })}
                value={reference.projectId}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(projectId) => update(key, { ...reference, projectId })}
              />
              <Field
                label={uiText('Infisical environment for {value0}', { value0: key })}
                value={reference.environment}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(environment) => update(key, { ...reference, environment })}
              />
              <Field
                label={uiText('Infisical path for {value0}', { value0: key })}
                value={reference.path}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(path) => update(key, { ...reference, path })}
              />
              <Field
                label={uiText('Infisical domain for {value0}', { value0: key })}
                placeholder={uiText('Optional; CLI default')}
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
            destructive
            secondary
            label={uiText('Remove {value0}', { value0: key })}
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
        label={uiText('New secret environment variable')}
        value={name}
        placeholder={'API_KEY'}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setName}
      />
      <Action
        secondary
        label={uiText('Add reference')}
        disabled={disabled || Object.keys(value).length >= 64}
        onPress={() => {
          const key = name.trim()
          if (!decodeResult(agentEnvironmentNameSchema, key).success || Object.hasOwn(value, key)) {
            setError(
              uiText(
                'Enter a unique environment variable name. Runtime credentials cannot be referenced.',
              ),
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
        label={uiText('Refresh secret references')}
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
