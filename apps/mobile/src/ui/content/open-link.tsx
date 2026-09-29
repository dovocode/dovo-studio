import { useEffect, useState } from 'react'
import { Alert, Linking, Modal, Pressable, View } from 'react-native'
import WebView from 'react-native-webview'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Text } from './text'
import { colors } from '../theme'

let showInternal: ((url: string) => void) | undefined

export function openAppLink(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return Linking.openURL(url)
  return new Promise((resolve, reject) => {
    Alert.alert('Open link', url, [
      {
        text: 'In Dovo',
        onPress: () => {
          if (!showInternal) {
            reject(new Error('The in-app browser is unavailable'))
            return
          }
          showInternal(url)
          resolve()
        },
      },
      {
        text: 'Default browser',
        onPress: () => void Linking.openURL(url).then(resolve, reject),
      },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
    ])
  })
}

export function LinkBrowser() {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    showInternal = setUrl
    return () => {
      showInternal = undefined
    }
  }, [])
  return (
    <Modal visible={url !== null} animationType="slide" onRequestClose={() => setUrl(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
          }}
        >
          <Pressable accessibilityRole="button" onPress={() => setUrl(null)}>
            <Text>Close</Text>
          </Pressable>
          <Text numberOfLines={1} style={{ flex: 1, marginLeft: 16 }}>
            {url}
          </Text>
        </View>
        {url && (
          <WebView
            source={{ uri: url }}
            originWhitelist={['http://*', 'https://*']}
            onShouldStartLoadWithRequest={(request) => /^https?:\/\//i.test(request.url)}
          />
        )}
      </SafeAreaView>
    </Modal>
  )
}
