import { useEffect } from 'react'
import { AppState, Keyboard, type KeyboardEvent } from 'react-native'
import { useApplicationState } from '../runtime/state/application-state'

/** iOS can restore the keyboard before the app becomes active. Read its current state on resume. */
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
    ]
    return () => {
      for (const subscription of subscriptions) subscription.remove()
    }
  }, [])
  return keyboard
}
