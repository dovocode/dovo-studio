import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRef, useState } from 'react'
import { Action } from '../ui/controls/action'
import { DateTimePicker } from '../ui/controls/date-time-picker'
import { Text } from '../ui/content/text'
import { Sheet, type SheetHandle } from '../ui/layout/sheet'

export function BrowserSnoozeSheet({
  title,
  until,
  onSnooze,
  onClose,
}: {
  title: string
  until?: number
  onSnooze: (until: number) => void
  onClose: () => void
}) {
  const uiText = useInterfaceText()

  const sheet = useRef<SheetHandle>(null)
  const [value, setValue] = useState(() => {
    const date = new Date(until && until > Date.now() ? until : Date.now() + 3600000)
    date.setSeconds(0, 0)
    return date
  })
  const [error, setError] = useState('')
  return (
    <Sheet ref={sheet} title={`Snooze ${title}`} onClose={onClose}>
      <Text>Choose a future date and time. Times use this device’s time zone.</Text>
      <DateTimePicker
        value={value}
        onChange={(date) => {
          setValue(date)
          setError('')
        }}
      />
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <Action
        label="Snooze"
        onPress={() => {
          if (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now()) {
            setError('Choose a valid date and time in the future.')
            return
          }
          try {
            onSnooze(value.getTime())
            sheet.current?.dismiss(onClose)
          } catch (cause) {
            setError(String(cause))
          }
        }}
      />
      <Action secondary label={uiText('Cancel')} onPress={() => sheet.current?.dismiss(onClose)} />
    </Sheet>
  )
}
