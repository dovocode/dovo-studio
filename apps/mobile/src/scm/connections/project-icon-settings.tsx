import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { Image, View } from 'react-native'
import { Schema } from 'effect'
import { projectIcon, type Repository } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { colors, styles } from '../../ui/theme'

export function ProjectIconSettings({ repository }: { repository: Repository }) {
  const { call, refresh, connected } = useRuntime()
  const { busy, error, act } = useAction()
  const save = (data?: string) =>
    act(async () => {
      await call(
        '/api/scm/repositories/icon',
        { repositoryId: repository.id, data },
        Schema.Struct({ ok: Schema.Literal(true) }),
      )
      await refresh()
    })
  const choose = () =>
    act(async () => {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
      })
      if (result.canceled) return
      const file = new File(result.assets[0].uri)
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose an image smaller than 2 MB.')
      await call(
        '/api/scm/repositories/icon',
        { repositoryId: repository.id, data: await file.base64() },
        Schema.Struct({ ok: Schema.Literal(true) }),
      )
      await refresh()
    })
  const icon = projectIcon(repository)
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {icon ? (
          <Image source={{ uri: icon }} style={{ width: 32, height: 32, borderRadius: 7 }} />
        ) : (
          <View
            style={{ width: 32, height: 32, borderRadius: 7, backgroundColor: colors.elevated }}
          />
        )}
        <Text style={[styles.text, { flex: 1 }]}>Project icon</Text>
      </View>
      <View style={styles.row}>
        <Action secondary label="Choose image" disabled={!connected || busy} onPress={choose} />
        {repository.iconOverride && (
          <Action
            secondary
            label="Reset to detected"
            disabled={!connected || busy}
            onPress={() => save()}
          />
        )}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
