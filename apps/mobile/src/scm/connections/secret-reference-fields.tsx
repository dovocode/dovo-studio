import {
  defaultSecretReference,
  secretReferenceProviders,
  type AgentSecretReference,
} from '@dovo/protocol'
import { SettingsField as Field } from '../../screens/settings-controls'
import { SettingsChoice as Choice } from '../../screens/settings-controls'

/** One vault reference for a connection credential. Values are read on the runtime host only. */
export function SecretReferenceFields({
  value,
  onChange,
  disabled,
}: {
  value: AgentSecretReference
  onChange: (value: AgentSecretReference) => void
  disabled?: boolean
}) {
  return (
    <>
      <Choice
        label="Secret manager"
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
            ? 'Secret reference'
            : value.provider === 'bitwarden'
              ? 'Item ID'
              : value.provider === 'infisical'
                ? 'Secret name'
                : 'Host environment variable'
        }
        value={value.reference}
        editable={!disabled}
        autoCorrect={false}
        placeholder={
          value.provider === 'onepassword'
            ? 'op://vault/item/field'
            : value.provider === 'bitwarden'
              ? 'Item ID'
              : 'BITBUCKET_TOKEN'
        }
        onChangeText={(reference) => onChange({ ...value, reference })}
      />
      {value.provider === 'onepassword' && (
        <Field
          label="1Password account (optional)"
          value={value.account ?? ''}
          editable={!disabled}
          autoCorrect={false}
          onChangeText={(account) => onChange({ ...value, account: account || undefined })}
        />
      )}
      {value.provider === 'bitwarden' && (
        <Choice
          label="Bitwarden field"
          value={value.field ?? 'password'}
          disabled={disabled}
          items={[
            { id: 'password', name: 'Password' },
            { id: 'username', name: 'Username' },
          ]}
          onChange={(field) =>
            onChange({ ...value, field: field === 'username' ? 'username' : undefined })
          }
        />
      )}
      {value.provider === 'infisical' && (
        <>
          <Field
            label="Infisical project ID"
            value={value.projectId}
            editable={!disabled}
            autoCorrect={false}
            onChangeText={(projectId) => onChange({ ...value, projectId })}
          />
          <Field
            label="Infisical environment"
            value={value.environment}
            editable={!disabled}
            autoCorrect={false}
            placeholder="dev"
            onChangeText={(environment) => onChange({ ...value, environment })}
          />
          <Field
            label="Infisical secret folder"
            value={value.path}
            editable={!disabled}
            autoCorrect={false}
            placeholder="/"
            onChangeText={(path) => onChange({ ...value, path })}
          />
          <Field
            label="Infisical domain (optional)"
            value={value.domain ?? ''}
            editable={!disabled}
            autoCorrect={false}
            keyboardType="url"
            placeholder="CLI default"
            onChangeText={(domain) => onChange({ ...value, domain: domain || undefined })}
          />
        </>
      )}
    </>
  )
}
