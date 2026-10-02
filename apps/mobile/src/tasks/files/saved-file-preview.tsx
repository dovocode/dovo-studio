import { useEffect, useState } from 'react'
import { Image, ScrollView, View } from 'react-native'
import {
  filePreviewLabel,
  filePreviewSchema,
  fileSizeLabel,
  type FilePreview,
  type ChangedFile,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { styles } from '../../ui/theme'

export function SavedFilePreview({
  file,
  taskId,
  turnId,
}: {
  file: ChangedFile
  taskId: string
  turnId?: string
}) {
  const { call } = useRuntime()
  const key = JSON.stringify([taskId, turnId, file.path])
  const [result, setResult] = useState<{
    key: string
    preview: FilePreview | null
    error: string
  } | null>(null)
  const preview = result?.key === key ? result.preview : null
  const error = result?.key === key ? result.error : ''
  useEffect(() => {
    let active = true
    void call(
      '/api/tasks/file/preview',
      { id: taskId, path: file.path, turnId },
      filePreviewSchema,
    ).then(
      (result) => {
        if (active) setResult({ key, preview: result, error: '' })
      },
      (cause: unknown) => {
        if (active)
          setResult({
            key,
            preview: null,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      },
    )
    return () => {
      active = false
    }
  }, [call, taskId, turnId, file.path, key])
  return (
    <ScrollView contentContainerStyle={[styles.content, { gap: 12 }]}>
      <Text style={styles.muted}>
        {filePreviewLabel(file)} ·{' '}
        {file.preview?.kind === 'submodule' ||
        preview?.before?.kind === 'submodule' ||
        preview?.after?.kind === 'submodule'
          ? 'Submodule commit references saved in Git.'
          : 'Full contents saved in Git.'}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : !preview ? (
        <Text style={styles.muted}>Loading compact preview…</Text>
      ) : null}
      {(['before', 'after'] as const).map((name) => {
        const side = preview?.[name]
        const metadata = file.preview?.[name]
        return (
          <View key={name} style={[styles.card, { gap: 8 }]}>
            <Text>
              {name === 'before' ? 'Before' : 'After'}
              {(side || metadata) && side?.kind !== 'submodule' && metadata?.mode !== '160000'
                ? ` · ${fileSizeLabel(side?.size ?? metadata?.size ?? 0)}`
                : ''}
            </Text>
            {side?.image ? (
              <Image
                source={{ uri: side.image }}
                accessibilityLabel={`${name} preview of ${file.path}`}
                style={{ width: '100%', height: 256 }}
                resizeMode="contain"
              />
            ) : side?.text !== undefined ? (
              <Text selectable style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {side.text || '(empty file)'}
              </Text>
            ) : side ? (
              <Text style={styles.muted}>
                {side.notice ?? 'Binary contents saved. No text preview.'}
              </Text>
            ) : preview ? (
              <Text style={styles.muted}>File absent.</Text>
            ) : metadata ? (
              <Text selectable style={styles.muted}>
                {metadata.hash}
              </Text>
            ) : null}
            {side?.truncated && (
              <Text style={styles.muted}>
                First 64 KB shown. Full contents remain in the snapshot.
              </Text>
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}
