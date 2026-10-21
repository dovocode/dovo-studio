function nativeOnly(name: string): never {
  throw new Error(
    `The ${name} control requires native iOS or Android. Storybook renders the React Native web path only.`,
  )
}

function boundary(name: string) {
  return (..._args: unknown[]) => nativeOnly(name)
}

// Expo SwiftUI is native-only. These exports let the production modules load for their
// Platform.OS === 'web' branches; invoking any native component or modifier fails loudly.
export const Button = boundary('@expo/ui/swift-ui Button')
export const Host = boundary('@expo/ui/swift-ui Host')
export const HStack = boundary('@expo/ui/swift-ui HStack')
export const Menu = boundary('@expo/ui/swift-ui Menu')
export const Spacer = boundary('@expo/ui/swift-ui Spacer')
export const Text = boundary('@expo/ui/swift-ui Text')
export const Image = boundary('@expo/ui/swift-ui Image')
export const Label = boundary('@expo/ui/swift-ui Label')
export const BottomSheet = boundary('@expo/ui/swift-ui BottomSheet')
export const Group = boundary('@expo/ui/swift-ui Group')
export const NavigationStack = boundary('@expo/ui/swift-ui NavigationStack')
export const RNHostView = boundary('@expo/ui/swift-ui RNHostView')
export const Toolbar = boundary('@expo/ui/swift-ui Toolbar')
export const Picker = boundary('@expo/ui/swift-ui Picker')
export const Divider = boundary('@expo/ui/swift-ui Divider')

export const accessibilityAddTraits = boundary('SwiftUI accessibility modifier')
export const accessibilityLabel = boundary('SwiftUI accessibility modifier')
export const accessibilityValue = boundary('SwiftUI accessibility modifier')
export const background = boundary('SwiftUI background modifier')
export const buttonBorderShape = boundary('SwiftUI button shape modifier')
export const buttonStyle = boundary('SwiftUI button style modifier')
export const contentShape = boundary('SwiftUI content shape modifier')
export const controlSize = boundary('SwiftUI control size modifier')
export const disabled = boundary('SwiftUI disabled modifier')
export const font = boundary('SwiftUI font modifier')
export const foregroundStyle = boundary('SwiftUI foreground modifier')
export const frame = boundary('SwiftUI frame modifier')
export const interactiveDismissDisabled = boundary('SwiftUI presentation modifier')
export const labelStyle = boundary('SwiftUI label modifier')
export const lineLimit = boundary('SwiftUI line limit modifier')
export const navigationTitle = boundary('SwiftUI navigation modifier')
export const navigationBarTitleDisplayMode = boundary('SwiftUI navigation modifier')
export const padding = boundary('SwiftUI padding modifier')
export const presentationDetents = boundary('SwiftUI presentation modifier')
export const presentationDragIndicator = boundary('SwiftUI presentation modifier')
export const resizable = boundary('SwiftUI image modifier')
export const shapes = boundary('SwiftUI shapes')
export const tint = boundary('SwiftUI tint modifier')

export const isGlassEffectAPIAvailable = boundary('Expo glass effect API')
export const isLiquidGlassAvailable = boundary('Expo liquid glass API')
