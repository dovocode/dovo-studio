import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { composerReferences, composerReferenceIcon, type ComposerReference } from '@dovo/protocol'
import { Keyboard, useWindowDimensions, type TextInputProps, type ViewProps } from 'react-native'
import { useMemo, useState, useRef, useImperativeHandle, type ComponentType, type Ref } from 'react'
import { useTheme } from '../../ui/theme'
import { harnessIconImages, composerIconImages } from '../../agents/harness-icon-images'
import { carZoom, useCarMode } from '../../runtime/preferences/app-preferences'
import type {
  NativeComposerInputProps,
  NativeReferenceMessageProps,
} from './native-composer-input.types'

type InputProps = ViewProps & {
  ref?: Ref<{ readText: () => Promise<{ text: string; eventCount: number; revision: string }> }>
  content: {
    text: string
    revision: string
    eventCount: number
    references: (ComposerReference & { icon?: string; iconTemplate?: boolean })[]
    links?: NativeReferenceMessageProps['links']
  }
  editable: boolean
  displayOnly?: boolean
  messageFontSize?: number
  messageLineHeight?: number
  placeholder: string
  focusKey: string
  textColor: string
  mutedColor: string
  chipColor: string
  linkColor?: string
  onLink?: (event: { nativeEvent: { url: string } }) => void
  onTextChange: (event: { nativeEvent: { text: string; eventCount: number } }) => void
  onSourceSelection: (event: { nativeEvent: { start: number; end: number } }) => void
  onSize: (event: { nativeEvent: { height: number } }) => void
  onFocus?: TextInputProps['onFocus']
  onBlur?: TextInputProps['onBlur']
}
const nativeModule = requireOptionalNativeModule<{
  blur: () => Promise<void>
  supportsReferenceMessages?: boolean
  supportsDraftSnapshot?: boolean
}>('DovoComposerInput')
const Input: ComponentType<InputProps> | null = nativeModule
  ? requireNativeView('DovoComposerInput')
  : null
// Older native modules cannot fence a send against pending keyboard events.
export const nativeComposerAvailable = !!Input && nativeModule?.supportsDraftSnapshot === true
export const nativeReferenceMessagesAvailable =
  !!Input && nativeModule?.supportsReferenceMessages === true

function withIcon(reference: ComposerReference) {
  const image = reference.provider && harnessIconImages[reference.provider]
  return {
    ...reference,
    icon: image ? image.png : composerIconImages[composerReferenceIcon(reference)],
    iconTemplate: image ? image.template : true,
  }
}

export function NativeReferenceMessage({
  text,
  references,
  links,
  onLink,
}: NativeReferenceMessageProps) {
  const { colors } = useTheme()
  const { fontScale } = useWindowDimensions()
  const car = useCarMode()
  const scale = fontScale * (car ? carZoom : 1)
  const [height, setHeight] = useState(24)
  const content = useMemo(
    () => ({ text, revision: text, eventCount: 0, references: references.map(withIcon), links }),
    [text, references, links],
  )
  if (!Input) return null
  return (
    <Input
      content={content}
      displayOnly
      messageFontSize={17 * scale}
      messageLineHeight={25 * scale}
      editable={false}
      placeholder=""
      focusKey=""
      textColor={colors.text}
      mutedColor={colors.muted}
      chipColor={colors.surface}
      linkColor={colors.accent}
      onLink={({ nativeEvent }) => onLink(nativeEvent.url)}
      onTextChange={() => {}}
      onSourceSelection={() => {}}
      onSize={({ nativeEvent }) => setHeight(nativeEvent.height)}
      style={{ height }}
    />
  )
}
export function dismissComposerKeyboard() {
  if (nativeModule)
    void nativeModule
      .blur()
      .catch((error) => console.error('Could not dismiss composer keyboard', error))
  Keyboard.dismiss()
}
export function NativeComposerInput({
  value,
  revision,
  resources,
  focusKey,
  expanded,
  onChangeText,
  onSelectionChange,
  inputRef,
  ...props
}: NativeComposerInputProps) {
  const { colors } = useTheme()
  const [eventCount, setEventCount] = useState(0)
  const observed = useRef(0)
  const view = useRef<{
    readText: () => Promise<{ text: string; eventCount: number; revision: string }>
  }>(null)
  const currentRevision = useRef(revision)
  currentRevision.current = revision
  useImperativeHandle(
    inputRef,
    () => ({
      readText: async () => {
        const target = view.current
        if (!target) throw new Error('The message input is not ready. Try Send again.')
        const expected = currentRevision.current
        const snapshot = await target.readText()
        if (
          view.current !== target ||
          currentRevision.current !== expected ||
          snapshot.revision !== expected
        )
          throw new Error('The message changed before sending. Check it and try Send again.')
        if (snapshot.eventCount >= observed.current) {
          observed.current = snapshot.eventCount
          setEventCount(snapshot.eventCount)
          onChangeText?.(snapshot.text)
        }
        return snapshot.text
      },
    }),
    [onChangeText],
  )
  const [height, setHeight] = useState(44)
  const references = useMemo(
    () => composerReferences(value, resources).map(withIcon),
    [value, resources],
  )
  if (!Input) return null
  return (
    <Input
      {...props}
      ref={view}
      accessibilityLabel="Message"
      testID="Message"
      content={{ text: value, revision, eventCount, references }}
      focusKey={focusKey ?? ''}
      editable={props.editable !== false}
      placeholder={props.placeholder ?? ''}
      textColor={colors.text}
      mutedColor={colors.muted}
      chipColor={colors.surface}
      onTextChange={({ nativeEvent }) => {
        // Events queued before a send snapshot must not restore already submitted text.
        if (nativeEvent.eventCount <= observed.current) return
        observed.current = nativeEvent.eventCount
        setEventCount(nativeEvent.eventCount)
        onChangeText?.(nativeEvent.text)
      }}
      onSourceSelection={({ nativeEvent }) => onSelectionChange(nativeEvent)}
      onSize={({ nativeEvent }) => setHeight(nativeEvent.height)}
      style={{ height: Math.max(expanded ? 64 : 44, Math.min(144, height)) }}
    />
  )
}
