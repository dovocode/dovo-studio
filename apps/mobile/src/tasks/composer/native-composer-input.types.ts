import type { ComposerReferenceResources } from '@dovo/protocol'
import type { TextInputProps } from 'react-native'
import type { DraftSelection } from './dictation-draft'

export type NativeComposerInputProps = Pick<
  TextInputProps,
  'onFocus' | 'onBlur' | 'editable' | 'placeholder' | 'onChangeText'
> & {
  value: string
  revision: string
  resources: ComposerReferenceResources
  focusKey?: string
  expanded: boolean
  onSelectionChange: (selection: DraftSelection) => void
}
