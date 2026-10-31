import { useEffect, useRef, useState } from 'react'
import { Alert, Image, ScrollView, View } from 'react-native'
import { filePreviewSchema, markdownMediaKind, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { ProjectFileBrowser } from './project-file-browser'
import { CodeBlock } from '../../ui/content/code-block'
import { fileLanguage } from '../../ui/content/syntax-highlighter'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { useTheme } from '../../ui/theme'

export type ThreadFileDraft = {
  path: string
  checkoutId: string
  expected: string
  contents: string
}
type FileResult = {
  path: string
  contents?: string
  size?: number
  complete?: boolean
  truncated?: boolean
  startLine?: number
  hasMore?: boolean
  image?: string
  notice?: string
  error?: string
}

export function TaskFiles({
  task,
  draft,
  onDraftChange,
}: {
  task: Task
  draft: ThreadFileDraft | null
  onDraftChange: (draft: ThreadFileDraft | null) => void
}) {
  const { call, connected, snapshot, connection } = useRuntime()
  const { styles, colors } = useTheme()
  const [checkoutId, setCheckoutId] = useState(draft?.checkoutId ?? '')
  const [selected, setSelected] = useState(draft?.path ?? '')
  const [focusedLine, setFocusedLine] = useState<number>()
  const [fullRead, setFullRead] = useState(!!draft)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; file: FileResult }>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const owner = JSON.stringify([
    connection?.address,
    connection?.token,
    task.id,
    checkoutId,
    task.execution,
    task.checkoutBranch,
    task.existingWorktreePath,
    task.delegation?.checkoutId,
  ])
  const listKey = JSON.stringify([owner, revision])
  const fileKey = JSON.stringify([listKey, selected, focusedLine, fullRead])
  const currentKey = useRef(fileKey)
  currentKey.current = fileKey
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const file = result?.key === fileKey ? result.file : undefined
  const links = task.linkedCheckouts ?? []
  const link = links.find((link) => link.id === checkoutId)
  const readOnly = !!task.example || (checkoutId !== '' && link?.access !== 'edit')
  const editing = draft?.path === selected && draft.checkoutId === checkoutId ? draft : null
  const dirty = !!editing && editing.contents !== editing.expected
  useEffect(() => {
    if (!connected || !selected) return
    let active = true
    const load = async (): Promise<FileResult> => {
      const input = { id: task.id, path: selected, checkoutId: checkoutId || undefined }
      if (markdownMediaKind(selected) === 'image') {
        const preview = await call('/api/tasks/files/preview', input, filePreviewSchema)
        const side = preview.after
        return {
          path: selected,
          image: side?.image,
          notice: side?.notice,
          error: side?.image ? undefined : 'This image format cannot be previewed.',
        }
      }
      const result = await call(
        '/api/tasks/files/read',
        {
          ...input,
          preview: {
            startLine: fullRead ? 1 : (focusedLine ?? 1),
            maxBytes: fullRead ? 1024 * 1024 : 256 * 1024,
          },
        },
        responses.projectFile,
      )
      return result.complete === undefined
        ? { ...result, contents: result.contents.slice(0, 200000) }
        : result
    }
    void load().then(
      (file) => {
        if (active) setResult({ key: fileKey, file })
      },
      (error) => {
        if (active)
          setResult({
            key: fileKey,
            file: { path: selected, error: error instanceof Error ? error.message : String(error) },
          })
      },
    )
    return () => {
      active = false
    }
  }, [call, connected, task.id, checkoutId, selected, focusedLine, fullRead, fileKey])
  const discardThen = (action: () => void) => {
    if (saving) return
    const proceed = () => {
      onDraftChange(null)
      setSaveError('')
      action()
    }
    if (dirty)
      Alert.alert('Discard file edits?', 'Your unsaved changes will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: proceed },
      ])
    else proceed()
  }
  const save = async () => {
    if (
      !editing ||
      saving ||
      !connected ||
      readOnly ||
      file?.complete !== true ||
      file.truncated !== false ||
      file.startLine !== 1 ||
      file.size === undefined ||
      file.size > 1024 * 1024
    )
      return
    const key = fileKey
    setSaving(true)
    setSaveError('')
    try {
      const saved = await call(
        '/api/tasks/files/write',
        {
          id: task.id,
          checkoutId: checkoutId || undefined,
          path: editing.path,
          contents: editing.contents,
          expectedContents: editing.expected,
        },
        responses.projectFile,
      )
      if (mounted.current && currentKey.current === key) {
        setResult({
          key,
          file: {
            ...saved,
            size: new TextEncoder().encode(saved.contents).byteLength,
            complete: true,
            truncated: false,
            startLine: 1,
          },
        })
        onDraftChange(null)
      }
    } catch (error) {
      if (mounted.current && currentKey.current === key)
        setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  const editLimit =
    file?.complete !== true ||
    file.truncated !== false ||
    file.startLine !== 1 ||
    file.size === undefined ||
    file.size > 1024 * 1024
  const visibleContents = file?.contents?.slice(0, 200000) ?? ''
  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, gap: 8 }}>
        {!!links.length && (
          <Choice
            label="Project folder"
            value={checkoutId}
            disabled={saving}
            items={[
              {
                id: '',
                name:
                  snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
                    ?.name ?? 'Thread folder',
              },
              ...links.map((link) => ({
                id: link.id,
                name: `${snapshot?.workspace.repositories.find((repo) => repo.id === link.repositoryId)?.name ?? link.repositoryId}${link.access === 'read-only' ? ' (read-only)' : ''}`,
              })),
            ]}
            onChange={(value) =>
              discardThen(() => {
                setCheckoutId(value)
                setSelected('')
                setFocusedLine(undefined)
                setFullRead(false)
              })
            }
          />
        )}
        <View style={[styles.row, { gap: 8 }]}>
          {!!selected && (
            <Action
              secondary
              label="Browse files"
              disabled={saving}
              onPress={() => discardThen(() => setSelected(''))}
            />
          )}
          <Action
            secondary
            label="Refresh files"
            disabled={!connected || saving}
            onPress={() =>
              discardThen(() => {
                setRevision((value) => value + 1)
              })
            }
          />
        </View>
        {!connected && <Text style={styles.muted}>Reconnect to browse and save files.</Text>}
      </View>
      <View style={selected ? { display: 'none' } : { flex: 1, minHeight: 0 }}>
        <ProjectFileBrowser
          key={owner}
          taskId={task.id}
          checkoutId={checkoutId}
          revision={revision}
          onSelect={(path, line) => {
            setSelected(path)
            setFocusedLine(line)
            setFullRead(false)
          }}
        />
      </View>
      {!!selected && (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { gap: 12 }]}
        >
          <Text selectable style={{ color: colors.text, fontWeight: '600' }}>
            {selected}
          </Text>
          {!!file?.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {file.error}
            </Text>
          )}
          {!!saveError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {saveError}
            </Text>
          )}
          {!file && connected && !editing && <Text style={styles.muted}>Loading file…</Text>}
          {editing ? (
            <>
              <Field
                label="File contents"
                value={editing.contents}
                editable={!saving && !editLimit}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
                style={{ minHeight: 300, fontFamily: 'monospace', textAlignVertical: 'top' }}
                onChangeText={(contents) => onDraftChange({ ...editing, contents })}
              />
              <View style={[styles.row, { gap: 8 }]}>
                <Action
                  label={saving ? 'Saving…' : 'Save file'}
                  disabled={!connected || saving || readOnly || editLimit || !dirty}
                  onPress={() => void save()}
                />
                <Action
                  secondary
                  label="Cancel editing"
                  disabled={saving}
                  onPress={() => discardThen(() => {})}
                />
              </View>
              <Text style={styles.muted}>
                Saves only if the file still matches the version you opened. Refresh to load changes
                from disk.
              </Text>
              {editLimit && (
                <Text style={styles.muted}>
                  A complete file read is required to continue editing.
                </Text>
              )}
            </>
          ) : (
            <>
              {file?.contents !== undefined && (
                <>
                  <Action
                    secondary
                    label="Edit file"
                    disabled={!connected || readOnly || editLimit}
                    onPress={() =>
                      onDraftChange({
                        path: selected,
                        checkoutId,
                        contents: file.contents ?? '',
                        expected: file.contents ?? '',
                      })
                    }
                  />
                  {editLimit && (
                    <Text style={styles.muted}>
                      {file.size === undefined
                        ? 'Update the runtime for bounded, editable file previews.'
                        : `Read-only preview · ${file.size} bytes total.`}
                    </Text>
                  )}
                  {editLimit && file.size !== undefined && file.size <= 1024 * 1024 && (
                    <Action
                      secondary
                      label="Load complete file to edit"
                      onPress={() => setFullRead(true)}
                    />
                  )}
                  {(file.hasMore || file.contents.length > visibleContents.length) &&
                    visibleContents.includes('\n') && (
                      <Action
                        secondary
                        label="Next lines"
                        onPress={() => {
                          setFocusedLine(
                            (file.startLine ?? 1) + (visibleContents.match(/\n/g)?.length ?? 0),
                          )
                          setFullRead(false)
                        }}
                      />
                    )}
                  {!!focusedLine && (
                    <View style={{ gap: 6 }} accessibilityLabel={`Selected line ${focusedLine}`}>
                      <Text style={styles.muted}>Search result · line {focusedLine}</Text>
                      <CodeBlock
                        content={file.contents
                          .split('\n')
                          .slice(
                            Math.max(0, focusedLine - (file.startLine ?? 1) - 5),
                            focusedLine - (file.startLine ?? 1) + 6,
                          )
                          .map(
                            (line, index) =>
                              `${Math.max(0, focusedLine - (file.startLine ?? 1) - 5) + index + (file.startLine ?? 1) === focusedLine ? '→' : ' '} ${Math.max(0, focusedLine - (file.startLine ?? 1) - 5) + index + (file.startLine ?? 1)}  ${line}`,
                          )
                          .join('\n')}
                        language={fileLanguage(selected)}
                      />
                    </View>
                  )}
                  <CodeBlock content={visibleContents} language={fileLanguage(selected)} />
                  {file.contents.length > 200000 && (
                    <Text style={styles.muted}>
                      Preview limited to the first 200,000 characters.
                    </Text>
                  )}
                </>
              )}
              {!!file?.image && (
                <Image
                  accessibilityLabel={selected}
                  source={{ uri: file.image }}
                  resizeMode="contain"
                  style={{ width: '100%', height: 300 }}
                />
              )}
              {!!file?.notice && <Text style={styles.muted}>{file.notice}</Text>}
              {readOnly && <Text style={styles.muted}>This folder is read-only.</Text>}
            </>
          )}
        </ScrollView>
      )}
    </View>
  )
}
