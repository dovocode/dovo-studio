import { useState, type ReactNode } from 'react'
import { usePreventRemove } from 'expo-router'
import { Alert } from 'react-native'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { SettingsTargetProvider, useSettingsDraftState } from './settings-target'

export function usePreventSettingsDraftRemoval() {
  const uiText = useInterfaceText()
  const draftFlags = useSettingsDraftState()
  const [leaving, setLeaving] = useState(false)
  usePreventRemove(!!draftFlags && !leaving, ({ repeat }) => {
    if (draftFlags & 2) return
    Alert.alert(uiText('Unsaved settings'), uiText('Discard unsaved settings changes?'), [
      { text: uiText('Keep editing'), style: 'cancel' },
      {
        text: uiText('Discard'),
        style: 'destructive',
        onPress: () => {
          setLeaving(true)
          repeat()
        },
      },
    ])
  })
}

function DraftRouteContent({ children }: { children: ReactNode }) {
  usePreventSettingsDraftRemoval()
  return children
}

/** A route owns its drafts independently of other mounted screens in the native stack. */
export function SettingsDraftRoute({ children }: { children: ReactNode }) {
  return (
    <SettingsTargetProvider>
      <DraftRouteContent>{children}</DraftRouteContent>
    </SettingsTargetProvider>
  )
}
