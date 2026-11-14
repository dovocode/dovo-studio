import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  defaultSecretReference,
  secretReferenceProviders,
  type AgentSecretReference,
} from '@dovo/protocol'
import { SettingsField as Field } from '../screens/settings-controls'
import { SettingsChoice as Choice } from '../screens/settings-controls'

/** One host-resolved secret reference. Values are read on the runtime host only. */
export function SecretReferenceFields({
  value,
  onChange,
  disabled,
}: {
  value: AgentSecretReference
  onChange: (value: AgentSecretReference) => void
  disabled?: boolean
}) {
  const uiText = useInterfaceText()

  return (
    <>
      <Choice
        label={uiText('Secret manager')}
        value={value.provider}
        disabled={disabled}
        items={[...secretReferenceProviders]}
        onChange={(provider) => {
          const option = secretReferenceProviders.find((item) => item.id === provider)
          if (option) onChange(defaultSecretReference(option.id))
        }}
      />
      <Field
        label={
          value.provider === 'onepassword'
            ? uiText('Secret reference')
            : value.provider === 'bitwarden'
              ? uiText('Item ID')
              : value.provider === 'infisical'
                ? uiText('Secret name')
                : uiText('Host environment variable')
        }
        value={value.reference}
        editable={!disabled}
        autoCorrect={false}
        placeholder={
          value.provider === 'onepassword'
            ? uiText('op://vault/item/field')
            : value.provider === 'bitwarden'
              ? uiText('Item ID')
              : 'API_KEY'
        }
        onChangeText={(reference) => onChange({ ...value, reference })}
      />
      {value.provider === 'onepassword' && (
        <Field
          label={uiText('1Password account (optional)')}
          value={value.account ?? ''}
          editable={!disabled}
          autoCorrect={false}
          onChangeText={(account) => onChange({ ...value, account: account || undefined })}
        />
      )}
      {value.provider === 'bitwarden' && (
        <Choice
          label={uiText('Bitwarden field')}
          value={value.field ?? 'password'}
          disabled={disabled}
          items={[
            { id: 'password', name: uiText('Password') },
            { id: 'username', name: uiText('Username') },
          ]}
          onChange={(field) =>
            onChange({ ...value, field: field === 'username' ? 'username' : undefined })
          }
        />
      )}
      {value.provider === 'infisical' && (
        <>
          <Field
            label={uiText('Infisical project ID')}
            value={value.projectId}
            editable={!disabled}
            autoCorrect={false}
            onChangeText={(projectId) => onChange({ ...value, projectId })}
          />
          <Field
            label={uiText('Infisical environment')}
            value={value.environment}
            editable={!disabled}
            autoCorrect={false}
            placeholder={uiText('dev')}
            onChangeText={(environment) => onChange({ ...value, environment })}
          />
          <Field
            label={uiText('Infisical secret folder')}
            value={value.path}
            editable={!disabled}
            autoCorrect={false}
            placeholder="/"
            onChangeText={(path) => onChange({ ...value, path })}
          />
          <Field
            label={uiText('Infisical domain (optional)')}
            value={value.domain ?? ''}
            editable={!disabled}
            autoCorrect={false}
            keyboardType="url"
            placeholder={uiText('CLI default')}
            onChangeText={(domain) => onChange({ ...value, domain: domain || undefined })}
          />
        </>
      )}
    </>
  )
}
