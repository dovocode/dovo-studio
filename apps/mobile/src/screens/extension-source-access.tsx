import { Alert, View } from 'react-native'
import type { useStudioSourcePolicy } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'

export function ExtensionSourceAccess({
  policy,
  title,
  app = false,
}: {
  policy: ReturnType<typeof useStudioSourcePolicy>
  title: string
  app?: boolean
}) {
  const uiText = useInterfaceText()
  const current = policy.policy
  const allow = (access: 'session' | 'persistent') => {
    Alert.alert(
      uiText(
        app
          ? 'Allow this MCP App to use its server tools? These tools can make changes.'
          : 'Allow this extension to use the selected MCP tool?',
      ),
      title,
      [
        { text: uiText('Cancel'), style: 'cancel' },
        {
          text: uiText(access === 'session' ? 'Allow for session' : 'Always allow'),
          onPress: () => void policy.save({ access, autoLoad: current?.autoLoad ?? false }),
        },
      ],
    )
  }
  return (
    <View style={{ gap: 6 }}>
      {current && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Action
            secondary
            label={uiText('Allow for session')}
            disabled={policy.saving || current.access === 'session'}
            onPress={() => allow('session')}
          />
          <Action
            secondary
            label={uiText('Always allow')}
            disabled={policy.saving || current.access === 'persistent'}
            onPress={() => allow('persistent')}
          />
          {current.access !== 'off' && (
            <>
              <Action
                secondary
                label={uiText('Revoke access')}
                disabled={policy.saving}
                onPress={() => void policy.save({ access: 'off', autoLoad: false })}
              />
              <Action
                secondary
                label={uiText(current.autoLoad ? 'Disable load on open' : 'Load on open')}
                disabled={policy.saving}
                onPress={() => void policy.save({ ...current, autoLoad: !current.autoLoad })}
              />
            </>
          )}
        </View>
      )}
      {policy.error && <Text accessibilityRole="alert">{policy.error}</Text>}
    </View>
  )
}
