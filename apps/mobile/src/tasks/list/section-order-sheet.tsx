import { defaultThreadSectionOrder, moveThreadSection, threadSections } from '@dovo/protocol'
import { View } from 'react-native'
import {
  updateMobilePreferences,
  useMobilePreferences,
} from '../../runtime/preferences/app-preferences'
import { Sheet } from '../../ui/layout/sheet'
import { Text } from '../../ui/content/text'
import { IconButton } from '../../ui/controls/icon-button'
import { Action } from '../../ui/controls/action'
import { useTheme } from '../../ui/theme'

export function SectionOrderSheet({ onClose }: { onClose: () => void }) {
  const { styles } = useTheme()
  const preferences = useMobilePreferences()
  const order = preferences.threadSectionOrder ?? defaultThreadSectionOrder
  return (
    <Sheet title="Organize sections" onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Text style={styles.muted}>
          Change the order of thread categories. Empty sections stay hidden. Project and ungrouped
          threads use Active’s position.
        </Text>
        {order.map((id, index) => (
          <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.text, { flex: 1 }]}>
              {threadSections.find((section) => section.id === id)?.name}
            </Text>
            <IconButton
              icon="send"
              label={`Move ${id} up`}
              disabled={index === 0}
              onPress={() =>
                updateMobilePreferences({ threadSectionOrder: moveThreadSection(order, id, -1) })
              }
            />
            <IconButton
              icon="down"
              label={`Move ${id} down`}
              disabled={index === order.length - 1}
              onPress={() =>
                updateMobilePreferences({ threadSectionOrder: moveThreadSection(order, id, 1) })
              }
            />
          </View>
        ))}
        <Action
          secondary
          label="Reset section order"
          onPress={() =>
            updateMobilePreferences({ threadSectionOrder: [...defaultThreadSectionOrder] })
          }
        />
      </View>
    </Sheet>
  )
}
