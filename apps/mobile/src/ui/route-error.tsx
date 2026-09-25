import { useEffect } from 'react'
import { ScrollView, View } from 'react-native'
import { router, type ErrorBoundaryProps } from 'expo-router'
import { Text } from './text'
import { Action } from './action'
import { Icon } from './icon'
import { colors, styles } from './theme'

/** A failing screen must never blank or close the app; its tab stays usable. */
export function RouteError({ error, retry }: ErrorBoundaryProps) {
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
          Your tasks and saved work are safe. Try again, or go back to your tasks.
        </Text>
        {!!error.message && (
          <Text selectable numberOfLines={4} style={[styles.error, { textAlign: 'center' }]}>
            {error.message}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
        <Action label="Try again" onPress={() => void retry()} />
        <Action label="Go to tasks" secondary onPress={() => router.replace('/')} />
      </View>
    </ScrollView>
  )
}
