declare module 'react-native-web' {
  export const Pressable: import('react').ComponentType<{
    accessibilityLabel?: string
    accessibilityRole?: string
    accessibilityState?: { expanded?: boolean }
    children?: import('react').ReactNode
    disabled?: boolean
    onPress?: () => void
    style?:
      | import('react').CSSProperties
      | ((state: { pressed: boolean }) => import('react').CSSProperties)
  }>
}
