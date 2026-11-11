import { useRef, useState } from 'react'
import { Linking, View } from 'react-native'
import { router } from 'expo-router'
import type { LinkTarget } from '@dovo/studio-core/links'
import { RuntimeRoute } from '../../shell/runtime-route'
import { linkTargetHref } from '../../ui/content/app-link-target'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { WorkItemScreen } from './work-item'

export default function PipelinePreview({
  target,
  onClose,
}: {
  target: LinkTarget
  onClose: () => void
}) {
  const sheet = useRef<SheetHandle>(null)
  const [error, setError] = useState('')
  const { styles } = useTheme()
  if (target.kind !== 'pipeline') return null
  const close = () => sheet.current?.dismiss()
  return (
    <Sheet
      title="Pipeline preview"
      ref={sheet}
      presentation="dialog"
      scrollable={false}
      onClose={onClose}
      footer={
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Action
              label="Open details"
              secondary
              onPress={() => sheet.current?.dismiss(() => router.push(linkTargetHref(target)))}
            />
            <Action
              label="Open URL"
              secondary
              onPress={() => {
                void Linking.openURL(target.url).catch((cause: unknown) => setError(String(cause)))
              }}
            />
          </View>
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      }
    >
      <View style={{ height: 520, minHeight: 0, flexShrink: 1 }}>
        <RuntimeRoute
          runtimeId={target.runtimeId}
          repositoryId={target.repositoryId}
          title="Pipeline"
          backTo="/pulls"
          onBack={close}
        >
          <WorkItemScreen
            mode="pipelines"
            preview
            repositoryId={target.repositoryId}
            itemId={target.itemId}
            expectedURL={target.url}
            onBack={close}
          />
        </RuntimeRoute>
      </View>
    </Sheet>
  )
}
