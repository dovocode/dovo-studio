import { useRef, useState, type ComponentRef } from 'react'
import { Pressable, View } from 'react-native'
import { ActionMenu, type MenuAction, type MenuAnchor } from '../../ui/controls/action-menu'
import { Icon } from '../../ui/controls/icon'
import { useTheme } from '../../ui/theme'

export type QueueMenuProps = { label: string; actions: MenuAction[] }

/** Keep queue actions anchored to their row, outside the bounded queue's clipping area. */
export function QueueMenu({ label, actions }: QueueMenuProps) {
  const { colors } = useTheme()
  const trigger = useRef<ComponentRef<typeof View>>(null)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  return (
    <View ref={trigger} collapsable={false} style={{ width: 44, height: 44, flexShrink: 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: !!anchor }}
        onPress={() =>
          trigger.current?.measureInWindow((x, y, width, height) =>
            setAnchor({ x, y, width, height }),
          )
        }
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="more" size={20} color={colors.muted} />
      </Pressable>
      <ActionMenu
        label={label}
        anchor={anchor}
        actions={actions}
        onClose={() => setAnchor(null)}
        dismissLabel="Dismiss queued message actions"
      />
    </View>
  )
}
