import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { Image, Pressable, View } from 'react-native'
import { Schema } from 'effect'
import {
  projectIcon,
  projectIconColor,
  projectIconInitials,
  projectIconChoices,
  sharedProjectKey,
  type Repository,
} from '@dovo/protocol'
import { useState } from 'react'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { Sheet } from '../../ui/layout/sheet'

export function ProjectIconSettings({ repository }: { repository: Repository }) {
  const { styles } = useTheme()

  const { call, refresh, connected } = useRuntime()
  const { busy, error, act } = useAction()
  const [picker, setPicker] = useState(false)
  const save = (data?: string) =>
    act(async () => {
      await call(
        '/api/scm/repositories/icon',
        { repositoryId: repository.id, data },
        Schema.Struct({ ok: Schema.Literal(true) }),
      )
      await refresh()
      setPicker(false)
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
            style={{
              width: 32,
              height: 32,
              borderRadius: 7,
              backgroundColor: projectIconColor(repository),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
              {projectIconInitials(repository)}
            </Text>
          </View>
        )}
        <Text style={[styles.text, { flex: 1 }]}>Project icon</Text>
      </View>
      <Text style={styles.muted}>
        {sharedProjectKey(repository)
          ? 'Icons sync across paired computers with the same Git remote.'
          : 'This project’s icon stays on this computer.'}
      </Text>
      <View style={styles.row}>
        <Action secondary label="Choose image" disabled={!connected || busy} onPress={choose} />
        <Action
          secondary
          label="Icon or emoji"
          disabled={!connected || busy}
          onPress={() => setPicker(true)}
        />
        {repository.iconOverride && (
          <Action
            secondary
            label="Reset to detected"
            disabled={!connected || busy}
            onPress={() => save()}
          />
        )}
      </View>
      {picker && (
        <Sheet title="Choose project icon" busy={busy} onClose={() => setPicker(false)}>
          {(['icon', 'emoji'] as const).map((kind) => (
            <View key={kind} style={{ gap: 8, marginBottom: 16 }}>
              <Text style={styles.text}>{kind === 'icon' ? 'Icons' : 'Emoji'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {projectIconChoices
                  .filter((choice) => choice.kind === kind)
                  .map((choice) => (
                    <Pressable
                      key={choice.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${kind === 'icon' ? 'Icon' : 'Emoji'}: ${choice.label}`}
                      disabled={!connected || busy}
                      onPress={() => save(choice.data.split(',')[1])}
                      style={{
                        width: 44,
                        height: 44,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Image source={{ uri: choice.data }} style={{ width: 32, height: 32 }} />
                    </Pressable>
                  ))}
              </View>
            </View>
          ))}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </Sheet>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
