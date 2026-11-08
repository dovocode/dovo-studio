import {
  defaultSecretReference,
  secretReferenceProviders,
  type AgentSecretReference,
} from '@dovo/protocol'
import {
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dovo/studio-ui'

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
      <FormField label="Secret manager">
        <Select
          value={value.provider}
          disabled={disabled}
          onValueChange={(provider) => {
            const option = secretReferenceProviders.find((item) => item.id === provider)
            if (option) onChange(defaultSecretReference(option.id))
          }}
        >
          <SelectTrigger aria-label="Secret manager" className="w-full">
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
      </FormField>
      <FormField
        label={
          value.provider === 'onepassword'
            ? 'Secret reference'
            : value.provider === 'bitwarden'
              ? 'Item ID'
              : value.provider === 'infisical'
                ? 'Secret name'
                : 'Host environment variable'
        }
      >
        <Input
          required
          value={value.reference}
          disabled={disabled}
          autoCapitalize="off"
          spellCheck={false}
          placeholder={
            value.provider === 'onepassword'
              ? 'op://vault/item/field'
              : value.provider === 'bitwarden'
                ? 'Item ID'
                : 'BITBUCKET_TOKEN'
          }
          onChange={(event) => onChange({ ...value, reference: event.target.value })}
        />
      </FormField>
      {value.provider === 'onepassword' && (
        <FormField label="1Password account (optional)">
          <Input
            value={value.account ?? ''}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => onChange({ ...value, account: event.target.value || undefined })}
          />
        </FormField>
      )}
      {value.provider === 'bitwarden' && (
        <FormField label="Bitwarden field">
          <Select
            value={value.field ?? 'password'}
            disabled={disabled}
            onValueChange={(field) => {
              if (field === 'password' || field === 'username')
                onChange({ ...value, field: field === 'password' ? undefined : field })
            }}
          >
            <SelectTrigger aria-label="Bitwarden field" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="password">Password</SelectItem>
              <SelectItem value="username">Username</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      )}
      {value.provider === 'infisical' && (
        <>
          <FormField label="Infisical project ID">
            <Input
              required
              value={value.projectId}
              disabled={disabled}
              spellCheck={false}
              onChange={(event) => onChange({ ...value, projectId: event.target.value })}
            />
          </FormField>
          <FormField label="Infisical environment">
            <Input
              required
              value={value.environment}
              disabled={disabled}
              spellCheck={false}
              placeholder="dev"
              onChange={(event) => onChange({ ...value, environment: event.target.value })}
            />
          </FormField>
          <FormField label="Infisical secret folder">
            <Input
              required
              value={value.path}
              disabled={disabled}
              spellCheck={false}
              placeholder="/"
              onChange={(event) => onChange({ ...value, path: event.target.value })}
            />
          </FormField>
          <FormField label="Infisical domain (optional)">
            <Input
              type="url"
              value={value.domain ?? ''}
              disabled={disabled}
              spellCheck={false}
              placeholder="CLI default"
              onChange={(event) => onChange({ ...value, domain: event.target.value || undefined })}
            />
          </FormField>
        </>
      )}
    </>
  )
}
