import { AccessibilityInfo, AppState, Platform } from 'react-native'
import { useEffect, useState } from 'react'
import { type Task } from '@dovo/protocol'
import { useTurnAnnouncements } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useMobilePreferences } from '../../../runtime/preferences/app-preferences'

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
  const { turnAnnouncements } = useMobilePreferences()
  const uiText = useInterfaceText()
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setForeground(state === 'active'),
    )
    return () => subscription.remove()
  }, [])
  useTurnAnnouncements({
    scope,
    task,
    steps,
    mode: turnAnnouncements,
    active: active && foreground,
    translate: uiText,
    announce: (text) => {
      if (AppState.currentState !== 'active') return
      if (Platform.OS === 'ios')
        AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true })
      else AccessibilityInfo.announceForAccessibility(text)
    },
  })
  return null
}
