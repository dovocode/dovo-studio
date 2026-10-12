import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { useState, type ComponentType } from 'react'
import { Alert, View, type ViewProps } from 'react-native'
import { useTheme } from '../../ui/theme'
import { Text } from '../../ui/content/text'
import type { AttachmentAsset } from './attachment-picker'

type DropProps = ViewProps & {
  enabled: boolean
  onFilesDropped: (event: { nativeEvent: { files: AttachmentAsset[] } }) => void
  onDropActive: (event: { nativeEvent: { active: boolean } }) => void
  onDropError: (event: { nativeEvent: { message: string } }) => void
}
const module = requireOptionalNativeModule<{ releaseFiles: (uris: string[]) => Promise<void> }>(
  'DovoFileDrop',
)
const NativeDrop: ComponentType<DropProps> | null = module
  ? requireNativeView('DovoFileDrop')
  : null

export function FileDropTarget({
  enabled,
  upload,
  children,
  ...props
}: ViewProps & {
  enabled: boolean
  upload: (assets: AttachmentAsset[]) => Promise<void>
}) {
  const { colors, styles } = useTheme()
  const [active, setActive] = useState(false)
  if (!NativeDrop) return <View {...props}>{children}</View>
  return (
    <NativeDrop
      {...props}
      enabled={enabled}
      onDropActive={({ nativeEvent }) => setActive(nativeEvent.active)}
      onDropError={({ nativeEvent }) =>
        Alert.alert('Could not attach dropped files', nativeEvent.message)
      }
      onFilesDropped={({ nativeEvent }) => {
        setActive(false)
        void (async () => {
          try {
            if (!enabled) throw new Error('Wait until the composer is ready to attach files.')
            await upload(nativeEvent.files)
          } catch (error) {
            Alert.alert(
              'Could not attach dropped files',
              error instanceof Error ? error.message : String(error),
            )
          } finally {
            try {
              await module?.releaseFiles(nativeEvent.files.map((file) => file.uri))
            } catch (error) {
              console.error('Could not remove dropped attachment files:', error)
            }
          }
        })()
      }}
    >
      {children}
      {active && enabled && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: colors.surface,
            borderColor: colors.accent,
            borderWidth: 2,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={styles.text}>Drop files to attach</Text>
        </View>
      )}
    </NativeDrop>
  )
}
