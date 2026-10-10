import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, View, Pressable } from 'react-native'
import { runClientEffect } from '@dovo/client-runtime'
import { taskImageReadSchema, type ToolImageReference } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../theme'
import { Text } from './text'
import { Action } from '../controls/action'
import { SafeModal } from '../layout/safe-modal'

type Source =
  | { taskId: string; path: string }
  | { taskId: string; reference: ToolImageReference }
  | { uri: string }
export function ServerImage({ source, label = 'Image' }: { source: Source; label?: string }) {
  const { callEffect, connected, connection } = useRuntime(),
    { styles, colors } = useTheme()
  const identity = JSON.stringify([connection?.address, connection?.token, source]),
    [revision, setRevision] = useState(0)
  const [loaded, setLoaded] = useState<{ identity: string; uri: string; error?: string }>(),
    [preview, setPreview] = useState(false)
  const uri = loaded?.identity === identity ? loaded.uri : undefined,
    error = loaded?.identity === identity ? loaded.error : undefined
  useEffect(() => {
    let active = true
    setLoaded(undefined)
    setPreview(false)
    if ('uri' in source) {
      setLoaded({ identity, uri: source.uri })
      return
    }
    if (!connected) {
      setLoaded({ identity, uri: '', error: 'Reconnect to the image’s computer to load it.' })
      return
    }
    const input =
      'reference' in source
        ? {
            taskId: source.taskId,
            eventId: source.reference.eventId,
            index: source.reference.index,
          }
        : { taskId: source.taskId, path: source.path }
    void runClientEffect(callEffect('/api/tasks/images/read', input, taskImageReadSchema)).then(
      (result) => {
        if (active) setLoaded({ identity, uri: result.uri })
      },
      (reason: unknown) => {
        if (active)
          setLoaded({
            identity,
            uri: '',
            error: reason instanceof Error ? reason.message : String(reason),
          })
      },
    )
    return () => {
      active = false
    }
  }, [identity, revision, connected, callEffect])
  const fail = () =>
    setLoaded((current) =>
      current?.identity === identity
        ? { identity, uri: '', error: 'Could not display this image. Retry to load it again.' }
        : current,
    )
  return (
    <View style={{ width: '100%', gap: 8 }}>
      {error ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.muted}>{error}</Text>
          <Action
            secondary
            label={`Retry ${label}`}
            onPress={() => setRevision((value) => value + 1)}
          />
        </View>
      ) : uri ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${label}`}
          onPress={() => setPreview(true)}
        >
          <Image
            source={{ uri }}
            accessibilityLabel={label}
            style={{ width: '100%', height: 280, borderRadius: 10 }}
            resizeMode="contain"
            onError={fail}
          />
        </Pressable>
      ) : (
        <View style={{ height: 80, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.muted} accessibilityLabel={`Loading ${label}`} />
        </View>
      )}
      <SafeModal
        visible={preview && !!uri}
        animationType="slide"
        onRequestClose={() => setPreview(false)}
      >
        <View style={styles.screen}>
          <ScrollView
            contentContainerStyle={styles.content}
            maximumZoomScale={4}
            minimumZoomScale={1}
          >
            <Action secondary label="Close image" onPress={() => setPreview(false)} />
            {uri && (
              <Image
                source={{ uri }}
                accessibilityLabel={label}
                resizeMode="contain"
                style={{ width: '100%', height: 600 }}
                onError={fail}
              />
            )}
          </ScrollView>
        </View>
      </SafeModal>
    </View>
  )
}
