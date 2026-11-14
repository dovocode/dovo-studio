import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  const { styles } = useTheme()
  const preferences = useMobilePreferences()
  const order = [
    'pinned' as const,
    ...(preferences.threadSectionOrder ?? defaultThreadSectionOrder).filter(
      (id) => id !== 'pinned',
    ),
  ]
  return (
    <Sheet title={uiText('Organize sections')} onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Pinned threads stay first, followed by Needs input. Change the order of other thread categories. Empty sections stay hidden. Project and ungrouped threads use Open’s position.'
            }
          </InterfaceText>
        </Text>
        {order.map((id, index) => (
          <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.text, { flex: 1 }]}>
              {threadSections.find((section) => section.id === id)?.name}
            </Text>
            <IconButton
              icon="send"
              label={uiText('Move {value0} up', { value0: id === 'active' ? 'open' : id })}
              disabled={id === 'pinned' || index <= 1}
              onPress={() =>
                updateMobilePreferences({ threadSectionOrder: moveThreadSection(order, id, -1) })
              }
            />
            <IconButton
              icon="down"
              label={uiText('Move {value0} down', { value0: id === 'active' ? 'open' : id })}
              disabled={id === 'pinned' || index === order.length - 1}
              onPress={() =>
                updateMobilePreferences({ threadSectionOrder: moveThreadSection(order, id, 1) })
              }
            />
          </View>
        ))}
        <Action
          secondary
          label={uiText('Reset section order')}
          onPress={() =>
            updateMobilePreferences({ threadSectionOrder: [...defaultThreadSectionOrder] })
          }
        />
      </View>
    </Sheet>
  )
}
