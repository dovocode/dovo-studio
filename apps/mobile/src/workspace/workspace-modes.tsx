import { router } from 'expo-router'
import { View, Pressable } from 'react-native'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { Icon, type IconName } from '../ui/controls/icon'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { Glass } from '../ui/layout/glass'
import { contentColumn } from '../ui/layout/content-column'

export function WorkspaceModes({ mode }: { mode: 'tasks' | 'browser' | 'terminal' | 'workspace' }) {
  const preferences = useMobilePreferences()
  const { colors } = useTheme()
  const unified = mode === 'workspace'
  const modes: {
    id: 'tasks' | 'browser' | 'terminal' | 'workspace'
    label: string
    path: '/' | '/browser' | '/terminal'
    icon: IconName
    enabled: boolean
  }[] = [
    {
      id: 'workspace',
      label: 'Unified',
      path: '/',
      icon: 'stack',
      enabled: preferences.unifiedWorkspaceEnabled,
    },
    { id: 'tasks', label: 'Threads', path: '/', icon: 'tasks', enabled: true },
    {
      id: 'browser',
      label: 'Browser',
      path: '/browser',
      icon: 'web',
      enabled: preferences.browserWorkspaceEnabled,
    },
    {
      id: 'terminal',
      label: 'Terminal',
      path: '/terminal',
      icon: 'terminal',
      enabled: preferences.terminalWorkspaceEnabled,
    },
  ]
  return (
    <View style={{ ...contentColumn.collection, paddingHorizontal: 16, paddingBottom: 8 }}>
      <Glass
        testID="Workspace modes glass"
        interactive
        style={{
          flexDirection: 'row',
          gap: 3,
          padding: 4,
          borderRadius: 999,
        }}
      >
        {modes
          .filter(
            (item) =>
              item.enabled &&
              (item.id === 'workspace' || !(unified && preferences.hideNormalWorkspaceModes)),
          )
          .map((item) => {
            const selected = mode === item.id
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.label} workspace`}
                accessibilityState={{ selected }}
                accessibilityHint={
                  item.id === 'workspace' && selected ? 'Show separate workspace modes' : undefined
                }
                onPress={() => {
                  updateMobilePreferences({
                    unifiedWorkspaceActive: item.id === 'workspace' && !unified,
                  })
                  router.navigate(item.path)
                }}
                style={({ pressed }) => ({
                  flex: 1,
                  minWidth: 0,
                  minHeight: 48,
                  paddingHorizontal: 6,
                  paddingVertical: 6,
                  gap: 3,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  backgroundColor: selected || pressed ? colors.selection : 'transparent',
                })}
              >
                <Icon name={item.icon} size={16} color={selected ? colors.accent : colors.muted} />
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 16,
                    textAlign: 'center',
                    fontWeight: selected ? '600' : '500',
                    color: selected ? colors.text : colors.muted,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            )
          })}
      </Glass>
    </View>
  )
}
