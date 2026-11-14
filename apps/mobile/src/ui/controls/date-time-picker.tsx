import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { DatePicker, Host } from '@expo/ui/swift-ui'
import { useTheme } from '../theme'

export function DateTimePicker({
  value,
  onChange,
}: {
  value: Date
  onChange: (date: Date) => void
}) {
  const uiText = useInterfaceText()

  const { mode, colors } = useTheme()
  return (
    <Host matchContents={{ vertical: true }} colorScheme={mode} seedColor={colors.accent}>
      <DatePicker
        title={uiText('Wake date and time')}
        selection={value}
        displayedComponents={['date', 'hourAndMinute']}
        range={{ start: new Date() }}
        onDateChange={onChange}
      />
    </Host>
  )
}
