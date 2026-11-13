import type { CredentialField } from '@dovo/protocol'
import { Button, Input } from '@dovo/studio-ui'
export function CredentialEditor({
  fields,
  onChange,
  disabled,
}: {
  fields: CredentialField[]
  onChange: (fields: CredentialField[]) => void
  disabled: boolean
}) {
  const change = (index: number, patch: Partial<CredentialField>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div key={index} className="space-y-2 rounded border p-3">
          <Input
            aria-label={`Credential ${index + 1} name`}
            placeholder="Name, e.g. API_KEY"
            value={field.name}
            disabled={disabled || field.saved !== undefined}
            onChange={(event) => change(index, { name: event.target.value })}
          />
          {field.saved !== undefined && !field.replacing ? (
            <p className="text-xs text-muted-foreground">Configured · value hidden</p>
          ) : (
            <Input
              aria-label={`Value for ${field.name || 'new credential'}`}
              type="password"
              autoComplete="new-password"
              value={field.value}
              disabled={disabled}
              onChange={(event) => change(index, { value: event.target.value })}
            />
          )}
          <div className="flex gap-2">
            {field.saved !== undefined && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => change(index, { replacing: !field.replacing, value: '' })}
              >
                {field.replacing ? 'Keep saved value' : 'Replace'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(fields.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => onChange([...fields, { name: '', value: '', replacing: true }])}
      >
        Add credential
      </Button>
      <p className="text-xs text-muted-foreground">
        Changes take effect when you save. Remove a row to clear its saved value.
      </p>
    </div>
  )
}
