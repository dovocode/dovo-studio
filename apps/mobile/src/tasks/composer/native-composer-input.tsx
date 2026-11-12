import { Keyboard } from 'react-native'
import type { NativeComposerInputProps } from './native-composer-input.types'
export const nativeComposerAvailable = false
export function NativeComposerInput(_props: NativeComposerInputProps) {
  return null
}
export const dismissComposerKeyboard = () => Keyboard.dismiss()
