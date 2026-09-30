import { useEffect, useRef } from 'react'
import { router, useRootNavigationState } from 'expo-router'
import { Platform } from 'react-native'
import * as QuickActions from 'expo-quick-actions'
let consumedInitial = false
export function TaskQuickActions() {
  const navigation = useRootNavigationState()
  const navigationReady = useRef(false)
  navigationReady.current = !!navigation?.key
  const pending = useRef(false)
  useEffect(() => {
    if (
      navigation?.key &&
      (pending.current || (!consumedInitial && QuickActions.initial?.id === 'dovo.launch'))
    ) {
      pending.current = false
      consumedInitial = true
      router.navigate('/launch')
    }
  }, [navigation?.key])
  useEffect(() => {
    let current = true
    const open = (action: QuickActions.Action) => {
      if (!current || action.id !== 'dovo.launch') return
      if (navigationReady.current) router.navigate('/launch')
      else pending.current = true
    }
    const subscription = QuickActions.addListener(open)
    void QuickActions.isSupported()
      .then(async (supported) => {
        if (supported && current)
          await QuickActions.setItems([
            {
              id: 'dovo.launch',
              title: 'Start a task',
              subtitle: 'Choose server, project and favorite agent',
              ...(Platform.OS === 'ios' ? { icon: 'compose' } : {}),
              params: { href: '/launch' },
            },
          ])
      })
      .catch((cause: unknown) => console.error('Could not configure task shortcuts:', cause))
    return () => {
      current = false
      subscription.remove()
    }
  }, [])
  return null
}
