import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type ComponentRef,
} from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import type { AccessibleNotificationInput } from './visibility'
import type { createNotificationViewport } from './viewport'

export const NotificationViewportContext = createContext<ReturnType<
  typeof createNotificationViewport
> | null>(null)

export function NotificationInputView({
  input,
  enabled,
  style,
  children,
}: {
  input: AccessibleNotificationInput | undefined
  enabled: boolean
  style?: StyleProp<ViewStyle>
  children: ReactNode
}) {
  const viewport = useContext(NotificationViewportContext)
  const view = useRef<ComponentRef<typeof View>>(null)
  useLayoutEffect(() => {
    if (!viewport || !enabled || !input) return
    return viewport.observe(input, (callback) => {
      view.current?.measureInWindow?.((x, y, width, height) => callback({ x, y, width, height }))
    })
  }, [viewport, enabled, input?.runtimeId, input?.taskId, input?.inputId, input?.inputType])
  return (
    <View ref={view} collapsable={false} onLayout={() => viewport?.refresh()} style={style}>
      {children}
    </View>
  )
}
