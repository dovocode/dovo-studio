import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dovo/studio-ui'

/** Finite preference choices, with validation before forwarding a typed value. */
export function SettingsSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const option = options.find(([id]) => id === next)
        if (option) onChange(option[0])
      }}
    >
      <SelectTrigger aria-label={label} className="w-full sm:w-48">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
