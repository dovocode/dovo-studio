import { useState } from 'react'
import { type Task } from '@dovo/protocol'
import { useAppPreferences, useTurnAnnouncements } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'

export function TurnAnnouncer({
  scope,
  task,
  steps,
  active,
}: {
  scope: string
  task: Pick<Task, 'messages' | 'turns' | 'status'>
  steps: readonly { id: string; turnId?: string; status: string; summary: string }[]
  active: boolean
}) {
  const { turnAnnouncements } = useAppPreferences()
  const uiText = useInterfaceText()
  const [text, setText] = useState({ value: '', revision: 0 })
  useTurnAnnouncements({
    scope,
    task,
    steps,
    mode: turnAnnouncements,
    active,
    translate: uiText,
    announce: (value) => setText((old) => ({ value, revision: old.revision + 1 })),
  })
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      <span key={text.revision}>{text.value}</span>
    </div>
  )
}
