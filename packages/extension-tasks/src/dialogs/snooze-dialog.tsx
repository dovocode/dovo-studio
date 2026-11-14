import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@dovo/studio-ui'

function localDateTime(value: number) {
  const date = new Date(value)
  return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function SnoozeDialog({
  name,
  until,
  onSnooze,
  onClose,
}: {
  name: string
  until?: number
  onSnooze: (until: number) => void
  onClose: () => void
}) {
  const uiText = useInterfaceText()

  const [value, setValue] = useState(() =>
    localDateTime(until && until > Date.now() ? until : Date.now() + 3600000),
  )
  const [error, setError] = useState('')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>Snooze {name}</DialogTitle>
        <DialogDescription>
          Choose a future date and time. Times use this device’s time zone.
        </DialogDescription>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const timestamp = new Date(value).getTime()
            if (
              !Number.isFinite(timestamp) ||
              timestamp <= Date.now() ||
              localDateTime(timestamp) !== value
            ) {
              setError('Choose a valid date and time in the future.')
              return
            }
            try {
              onSnooze(timestamp)
              onClose()
            } catch (cause) {
              setError(String(cause))
            }
          }}
        >
          <Input
            aria-label="Wake date and time"
            type="datetime-local"
            required
            min={localDateTime(Date.now())}
            value={value}
            aria-invalid={!!error}
            onChange={(event) => {
              setValue(event.target.value)
              setError('')
            }}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {uiText('Cancel')}
            </Button>
            <Button type="submit">Snooze</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
