import { DateTimePicker as ComposeDateTimePicker, Host, Column } from '@expo/ui/jetpack-compose'
import { useTheme } from '../theme'

export function DateTimePicker({
  value,
  onChange,
}: {
  value: Date
  onChange: (date: Date) => void
}) {
  const { mode, colors } = useTheme()
  // Material's date picker uses UTC midnight; its time picker uses local hours.
  const day = Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  return (
    <Host matchContents={{ vertical: true }} colorScheme={mode} seedColor={colors.accent}>
      <Column>
        <ComposeDateTimePicker
          displayedComponents="date"
          showVariantToggle={false}
          initialDate={new Date(day).toISOString()}
          onDateSelected={(date) => {
            if (!date) return
            const next = new Date(
              date.getUTCFullYear(),
              date.getUTCMonth(),
              date.getUTCDate(),
              value.getHours(),
              value.getMinutes(),
            )
            if (next.getTime() !== value.getTime()) onChange(next)
          }}
        />
        <ComposeDateTimePicker
          displayedComponents="hourAndMinute"
          initialDate={value.toISOString()}
          onDateSelected={(date) => {
            if (!date) return
            const next = new Date(value)
            next.setHours(date.getHours(), date.getMinutes(), 0, 0)
            if (next.getTime() !== value.getTime()) onChange(next)
          }}
        />
      </Column>
    </Host>
  )
}
