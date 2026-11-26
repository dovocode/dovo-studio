import { useEffect } from 'react'
import { AppState, Keyboard, Platform, type KeyboardEvent } from 'react-native'
import { useApplicationState } from '../runtime/state/application-state'

/** Resync keyboard state on resume and when Android gives the recreated activity focus. */
export function useSoftwareKeyboard() {
  const visible = () =>
    AppState.currentState === 'active' && (Keyboard.metrics?.()?.height ?? 0) > 0
  const [keyboard, setKeyboard] = useApplicationState(visible)
  useEffect(() => {
    // The shortcut responder has a zero-height input view. It must not hide navigation
    // or enable keyboard padding when iOS unlocks.
    const show = (event: KeyboardEvent) =>
      setKeyboard(AppState.currentState === 'active' && event.endCoordinates.height > 0)
    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', show),
      Keyboard.addListener('keyboardDidShow', show),
      Keyboard.addListener('keyboardWillHide', () => setKeyboard(false)),
      Keyboard.addListener('keyboardDidHide', () => setKeyboard(false)),
      AppState.addEventListener('change', (state) =>
        setKeyboard(state === 'active' && (Keyboard.metrics?.()?.height ?? 0) > 0),
      ),
      ...(Platform.OS === 'android'
        ? [AppState.addEventListener('focus', () => setKeyboard(visible()))]
        : []),
    ]
    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  }, [])
  return keyboard
}
