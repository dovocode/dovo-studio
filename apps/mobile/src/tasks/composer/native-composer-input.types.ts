import type { ComposerReference, ComposerReferenceResources } from '@dovo/protocol'
import type { TextInputProps } from 'react-native'
import type { DraftSelection } from './dictation-draft'
import type { Ref } from 'react'

export type ComposerInputHandle = { readText: () => Promise<string> }

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
  inputRef?: Ref<ComposerInputHandle>
}

export type NativeReferenceMessageProps = {
  text: string
  references: ComposerReference[]
  links: { start: number; end: number; url: string }[]
  onLink: (url: string) => void
}
