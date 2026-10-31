import { DiffView } from '../preview/diff-view'
import { useEffect, useMemo, useState } from 'react'
import { Image, Pressable, ScrollView, View } from 'react-native'
import {
  filePreviewLabel,
  filePreviewSchema,
  fileSizeLabel,
  type FilePreview,
  type ChangedFile,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { CodeBlock } from '../../ui/content/code-block'
import { fileLanguage } from '../../ui/content/syntax-highlighter'

export function SavedFilePreview({
  file,
  taskId,
  turnId,
  commitSha,
  checkoutId,
  working = false,
}: {
  file: ChangedFile
  taskId: string
  turnId?: string
  commitSha?: string
  checkoutId?: string
  working?: boolean
}) {
  const { styles } = useTheme()

  const { read, connection } = useRuntime()
  const [fullKey, setFullKey] = useState('')
  const [attempt, setAttempt] = useState(0)
  const ownerKey = JSON.stringify([
    connection?.address,
    connection?.token,
    taskId,
    turnId,
    commitSha,
    checkoutId,
    working,
    file.path,
  ])
  const full = fullKey === ownerKey
  const key = JSON.stringify([ownerKey, full, attempt])
  const [result, setResult] = useState<{
    key: string
    file: ChangedFile
    preview: FilePreview | null
    error: string
  } | null>(null)
  const preview = result?.key === key && result.file === file ? result.preview : null
  const completeText =
    preview &&
    [preview.before, preview.after].every(
      (side) => !side || (side.kind === 'text' && !side.truncated),
    )
  const diff = useMemo(
    () =>
      completeText
        ? {
            path: file.path,
            before: preview.before?.text ?? '',
            after: preview.after?.text ?? '',
            viewed: false,
          }
        : null,
    [completeText, preview, file.path],
  )
  const error = result?.key === key && result.file === file ? result.error : ''
  useEffect(() => {
    let active = true
    void read(
      commitSha ? '/api/tasks/commits/file-preview' : '/api/tasks/file/preview',
      {
        id: taskId,
        path: file.path,
        turnId,
        checkoutId,
        working,
        full,
        patch: true,
        sha: commitSha,
      },
      filePreviewSchema,
    ).then(
      (result) => {
        if (active) setResult({ key, file, preview: result, error: '' })
      },
      (cause: unknown) => {
        if (active)
          setResult({
            key,
            file,
            preview: null,
            error: cause instanceof Error ? cause.message : String(cause),
          })
      },
    )
    return () => {
      active = false
    }
  }, [read, taskId, turnId, commitSha, checkoutId, working, file.path, key, full, file])
  const patch = preview?.patch
  const displayDiff = diff && patch && patch.length <= 512 * 1024
  if (displayDiff)
    return <DiffView path={diff.path} before={diff.before} after={diff.after} patch={patch} />
  return (
    <ScrollView contentContainerStyle={[styles.content, { gap: 12 }]}>
      <Text style={styles.muted}>
        {filePreviewLabel(file)} ·{' '}
        {working
          ? 'Current working checkout · preview only.'
          : file.preview?.kind === 'submodule' ||
              preview?.before?.kind === 'submodule' ||
              preview?.after?.kind === 'submodule'
            ? 'Submodule commit references saved in Git.'
            : 'Full contents saved in Git.'}
      </Text>
      {diff && !displayDiff && (
        <Text accessibilityRole="alert" style={styles.error}>
          The diff is unavailable or too large for the viewer. Complete contents are shown below.
        </Text>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : !preview ? (
        <Text style={styles.muted}>{full ? 'Loading full diff…' : 'Loading compact preview…'}</Text>
      ) : null}
      {((preview &&
        [preview.before, preview.after].some((side) => side?.kind === 'text' && side.truncated)) ||
        (diff && !full && !patch) ||
        error) && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={full ? 'Retry full diff' : 'Load full diff'}
          onPress={() => {
            setFullKey(ownerKey)
            setAttempt((value) => value + 1)
          }}
          style={styles.card}
        >
          <Text>{full ? 'Retry full diff' : 'Load full diff'}</Text>
        </Pressable>
      )}
      {full && (preview?.before?.truncated || preview?.after?.truncated) && (
        <Text style={styles.muted}>
          This computer returned only a compact preview. Update it to load larger text diffs.
        </Text>
      )}
      {full && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show compact preview"
          onPress={() => setFullKey('')}
          style={styles.card}
        >
          <Text>Show compact preview</Text>
        </Pressable>
      )}
      {(full || preview?.before?.truncated || preview?.after?.truncated) && (
        <Text style={styles.muted}>
          Text diffs support up to 8 MB per side.{' '}
          {working ? 'The working file is unchanged.' : 'Full snapshots remain saved.'}
        </Text>
      )}
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
              side.text.length > 256 * 1024 ? (
                <Text selectable>{side.text}</Text>
              ) : (
                <CodeBlock
                  content={side.text || '(empty file)'}
                  language={fileLanguage(file.path)}
                />
              )
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
                First 64 KB shown. Load the full diff to compare changes beyond this preview.
              </Text>
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}
