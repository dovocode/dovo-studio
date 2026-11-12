import { Keyboard } from 'react-native'
import type {
  NativeComposerInputProps,
  NativeReferenceMessageProps,
} from './native-composer-input.types'
export const nativeComposerAvailable = false
export const nativeReferenceMessagesAvailable = false
export function NativeComposerInput(_props: NativeComposerInputProps) {
  return null
}
export function NativeReferenceMessage(_props: NativeReferenceMessageProps) {
  return null
}
export const dismissComposerKeyboard = () => Keyboard.dismiss()
