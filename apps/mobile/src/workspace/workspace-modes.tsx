import { router } from 'expo-router'
import { View, Pressable } from 'react-native'
import {
  useMobilePreferences,
  updateMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { Icon, type IconName } from '../ui/controls/icon'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { contentColumn } from '../ui/layout/content-column'

export function WorkspaceModes({ mode }: { mode: 'tasks' | 'browser' | 'terminal' | 'workspace' }) {
  const preferences = useMobilePreferences()
  const { colors } = useTheme()
  const unified = mode === 'workspace'
  const normal: {
    id: string
    label: string
    path: '/' | '/browser' | '/terminal'
    icon: IconName
    enabled: boolean
  }[] = [
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
    <View style={{ ...contentColumn.collection, paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}>
      {preferences.unifiedWorkspaceEnabled && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            minHeight: 44,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="stack" size={16} color={unified ? colors.accent : colors.muted} />
            <Text
              style={{
                color: unified ? colors.text : colors.muted,
                fontWeight: '500',
                fontSize: 14,
              }}
            >
              Unified
            </Text>
          </View>
          <Switch
            accessibilityLabel="Unified workspace"
            value={unified}
            onValueChange={(enabled) => {
              updateMobilePreferences({ unifiedWorkspaceActive: enabled })
              router.navigate('/')
            }}
          />
        </View>
      )}
      {!(unified && preferences.hideNormalWorkspaceModes) && (
        <View
          accessibilityLabel="Workspace modes"
          style={{
            flexDirection: 'row',
            gap: 3,
            padding: 3,
            borderRadius: 14,
            backgroundColor: colors.surface,
          }}
        >
          {normal
            .filter((item) => item.enabled)
            .map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`${item.label} workspace`}
                accessibilityState={{ selected: mode === item.id }}
                onPress={() => {
                  updateMobilePreferences({ unifiedWorkspaceActive: false })
                  router.navigate(item.path)
                }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  flexDirection: 'row',
                  gap: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 11,
                  backgroundColor: mode === item.id ? colors.selection : 'transparent',
                }}
              >
                <Icon
                  name={item.icon}
                  size={16}
                  color={mode === item.id ? colors.accent : colors.muted}
                />
                <Text
                  style={{
                    fontSize: 13,
                    color: mode === item.id ? colors.text : colors.muted,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
        </View>
      )}
    </View>
  )
}
