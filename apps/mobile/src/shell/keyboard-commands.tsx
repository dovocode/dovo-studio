import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { type ComponentType, type ReactNode } from 'react'
import { Platform, View, type ViewProps } from 'react-native'

export type KeyboardCommand = 'search' | 'newThread' | 'back'
type NativeProps = ViewProps & {
  enabledCommands: KeyboardCommand[]
  onCommand: (event: { nativeEvent: { command: KeyboardCommand } }) => void
}

const module = Platform.OS === 'ios' ? requireOptionalNativeModule('DovoKeyboardCommands') : null
const NativeCommands: ComponentType<NativeProps> | null = module
  ? requireNativeView('DovoKeyboardCommands')
  : null

export function KeyboardCommands({
  children,
  enabledCommands,
  onCommand,
}: {
  children: ReactNode
  enabledCommands: KeyboardCommand[]
  onCommand: (command: KeyboardCommand) => void
}) {
  if (!NativeCommands) return <View style={{ flex: 1 }}>{children}</View>
  return (
    <NativeCommands
      style={{ flex: 1 }}
      enabledCommands={enabledCommands}
      onCommand={(event) => onCommand(event.nativeEvent.command)}
    >
      {children}
    </NativeCommands>
  )
}
