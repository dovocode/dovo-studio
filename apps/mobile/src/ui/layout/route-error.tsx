import { useContext, useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Clipboard from 'expo-clipboard'
import { clientDiagnostic, diagnosticMessage } from '@dovo/protocol'
import { RuntimeContext } from '../../runtime/connection/context'
import { ScrollView, View } from 'react-native'
import { router, type ErrorBoundaryProps } from 'expo-router'
import { Text } from '../content/text'
import { Action } from '../controls/action'
import { Icon } from '../controls/icon'
import { useTheme } from '../theme'

/** A failing screen must never blank or close the app; its tab stays usable. */
export function RouteError({ error, retry }: ErrorBoundaryProps) {
  const { colors, styles } = useTheme()
  const runtime = useContext(RuntimeContext)
  const failure = useMemo(() => clientDiagnostic(error), [error])
  const diagnostic = {
    ...failure,
    context: {
      appVersion: Constants.expoConfig?.version,
      build: String(
        Platform.OS === 'ios'
          ? (Constants.expoConfig?.ios?.buildNumber ?? '')
          : (Constants.expoConfig?.android?.versionCode ?? ''),
      ),
      channel: String(Constants.expoConfig?.extra?.releaseChannel ?? 'dev'),
      platform: Platform.OS,
      computerName: runtime?.profile?.name,
      runtimeVersion: runtime?.snapshot?.releaseVersion,
      surface: 'mobile screen',
    },
  }
  const [copyStatus, setCopyStatus] = useState('')
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(JSON.stringify(diagnostic, null, 2))
      setCopyStatus('Diagnostics copied')
    } catch (cause) {
      setCopyStatus(diagnosticMessage(cause))
    }
  }

  useEffect(() => {
    console.error('Screen failed to render', error)
  }, [error])
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }}
    >
      <View accessibilityRole="alert" style={{ alignItems: 'center', gap: 10 }}>
        <Icon name="error" size={28} color={colors.warning} />
        <Text style={[styles.title, { textAlign: 'center' }]}>This screen hit a problem</Text>
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          Try again, or go back to your tasks. Diagnostics stay on this device until you copy them.
        </Text>
        {!!error.message && (
          <Text selectable numberOfLines={4} style={[styles.error, { textAlign: 'center' }]}>
            {diagnostic.error}
          </Text>
        )}
        <Text selectable style={styles.muted}>
          Diagnostic {diagnostic.id}
        </Text>
        {!!copyStatus && (
          <Text accessibilityLiveRegion="polite" style={styles.muted}>
            {copyStatus}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
        <Action label="Copy diagnostics" secondary onPress={() => void copy()} />
        <Action label="Try again" onPress={() => void retry()} />
        <Action label="Go to tasks" secondary onPress={() => router.replace('/')} />
      </View>
    </ScrollView>
  )
}
