import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, ScrollView, View, Pressable } from 'react-native'
import { clientTaskScope } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { taskImageReadSchema, type ToolImageReference } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../theme'
import { Text } from './text'
import { Action } from '../controls/action'
import { IconButton } from '../controls/icon-button'
import { useAction } from '../controls/use-action'
import { SafeModal } from '../layout/safe-modal'

type Source =
  | { taskId: string; path: string }
  | { taskId: string; reference: ToolImageReference }
  | { uri: string }
export function ServerImage({
  source,
  label = 'Image',
  onOpenOriginal,
}: {
  source: Source
  label?: string
  onOpenOriginal?: () => Promise<void>
}) {
  const original = useAction()
  const { readEffect, connected, connection } = useRuntime(),
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
    const requests = clientTaskScope()
    void requests.run(
      readEffect('/api/tasks/images/read', { ...input, maxSize: 1024 }, taskImageReadSchema).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (active) setLoaded({ identity, uri: result.uri })
          }),
        ),
        Effect.catch((reason) =>
          Effect.sync(() => {
            if (active) setLoaded({ identity, uri: '', error: reason.message })
          }),
        ),
      ),
    )
    return () => {
      active = false
      void requests.stop()
    }
  }, [identity, revision, connected, readEffect])
  const [expandedImage, setExpandedImage] = useState<{
    identity: string
    uri?: string
    error?: string
  }>()
  useEffect(() => {
    if (!preview || !connected || 'uri' in source) return
    let active = true
    const requests = clientTaskScope()
    setExpandedImage(undefined)
    const input =
      'reference' in source
        ? {
            taskId: source.taskId,
            eventId: source.reference.eventId,
            index: source.reference.index,
          }
        : { taskId: source.taskId, path: source.path }
    void requests.run(
      readEffect('/api/tasks/images/read', { ...input, maxSize: 2048 }, taskImageReadSchema).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (active) setExpandedImage({ identity, uri: result.uri })
          }),
        ),
        Effect.catch((reason) =>
          Effect.sync(() => {
            if (active)
              setExpandedImage({
                identity,
                error: `Showing the smaller preview. ${reason.message}`,
              })
          }),
        ),
      ),
    )
    return () => {
      active = false
      void requests.stop()
    }
  }, [preview, identity, connected, readEffect])
  const expanded = expandedImage?.identity === identity ? expandedImage : undefined
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
          {onOpenOriginal && (
            <Action
              secondary
              label="Open original & download"
              disabled={original.busy}
              onPress={() => original.act(onOpenOriginal)}
            />
          )}
          {!!original.error && (
            <Text accessibilityRole="alert" style={styles.muted}>
              {original.error}
            </Text>
          )}
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
            contentContainerStyle={[styles.content, { paddingTop: 68 }]}
            maximumZoomScale={4}
            minimumZoomScale={1}
          >
            {onOpenOriginal && (
              <Action
                secondary
                label="Open original & download"
                disabled={original.busy}
                onPress={() => original.act(onOpenOriginal)}
              />
            )}
            {!!original.error && (
              <Text accessibilityRole="alert" style={styles.muted}>
                {original.error}
              </Text>
            )}
            {expanded?.error && <Text style={styles.muted}>{expanded.error}</Text>}
            {preview && connected && !('uri' in source) && !expanded && (
              <ActivityIndicator color={colors.muted} accessibilityLabel="Loading sharper image" />
            )}
            {uri && (
              <Image
                source={{ uri: expanded?.uri ?? uri }}
                accessibilityLabel={label}
                resizeMode="contain"
                style={{ width: '100%', height: 600 }}
                onError={() => {
                  if (expanded?.uri)
                    setExpandedImage({
                      identity,
                      error: 'Could not display the sharper image. Showing the smaller preview.',
                    })
                  else fail()
                }}
              />
            )}
          </ScrollView>
          <View style={{ position: 'absolute', top: 12, right: 16, zIndex: 1 }}>
            <IconButton
              label="Close image"
              icon="close"
              variant="glass"
              onPress={() => setPreview(false)}
            />
          </View>
        </View>
      </SafeModal>
    </View>
  )
}
