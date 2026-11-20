import { terminalParentChoices, type RuntimeSnapshot } from '@dovo/protocol'
import { ChoicePicker } from '@dovo/studio-ui'

export function TerminalParentPicker({
  snapshot,
  value,
  onChange,
  disabled,
}: {
  snapshot?: RuntimeSnapshot | null
  value: string
  onChange: (id: string) => void
  disabled: boolean
}) {
  const candidates = terminalParentChoices(snapshot)
  if (!candidates.length && !value) return null
  return (
    <ChoicePicker
      aria-label="Parent terminal"
      className="h-7 w-auto max-w-44 border-0 bg-transparent text-xs shadow-none"
      value={value}
      onValueChange={onChange}
      disabled={disabled}
    >
      <option value="">No parent terminal</option>
      {value && !candidates.some((item) => item.id === value) && (
        <option value={value}>Parent unavailable</option>
      )}
      {candidates.map((item) => (
        <option value={item.id} key={item.id}>
          {item.title} · {item.id.slice(0, 8)}
        </option>
      ))}
    </ChoicePicker>
  )
}
