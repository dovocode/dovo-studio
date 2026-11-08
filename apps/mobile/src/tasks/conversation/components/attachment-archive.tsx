import { useEffect, useRef } from 'react'
import { Image, Pressable, ScrollView, View } from 'react-native'
import { shareAttachment } from './attachment-share'
import { Effect, Schema } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import {
  attachmentArchiveListSchema,
  attachmentArchiveReadSchema,
  attachmentReadSchema,
  attachmentCommitResultSchema,
  mutableStruct,
  fileSizeLabel,
  randomUUID,
  type Attachment,
  type AttachmentArchiveEntry,
  type AttachmentArchiveFile,
} from '@dovo/protocol'
import { nativeEffect, mobileWorkflow } from '../../../runtime/state/native-effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { useRuntime } from '../../../runtime/connection/provider'
import { SafeModal } from '../../../ui/layout/safe-modal'
import { Text } from '../../../ui/content/text'
import { Icon } from '../../../ui/controls/icon'
import { IconButton } from '../../../ui/controls/icon-button'
import { useAction } from '../../../ui/controls/use-action'
import { useTheme } from '../../../ui/theme'

export function archiveChildren(entries: AttachmentArchiveEntry[], folder: string) {
  const rows = new Map<string, AttachmentArchiveEntry>()
  for (const entry of entries) {
    if (!entry.path.startsWith(folder)) continue
    const remainder = entry.path.slice(folder.length)
    if (!remainder) continue
    const slash = remainder.indexOf('/')
    if (slash >= 0) {
      const path = folder + remainder.slice(0, slash + 1)
      rows.set(path, { path, directory: true, size: 0 })
    } else rows.set(entry.path, entry)
  }
  return [...rows.values()].sort(
    (a, b) => Number(b.directory) - Number(a.directory) || a.path.localeCompare(b.path),
  )
}

const imageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/** Archive bytes remain on the owning runtime; the phone downloads only the selected entry. */
export function AttachmentArchive({
  taskId,
  attachment,
  onClose,
  onBusy,
  disabled,
}: {
  taskId: string
  attachment: Attachment
  onClose: () => void
  onBusy?: (busy: boolean) => void
  disabled?: boolean
}) {
  const {
    connected,
    readEffect,
    callEffect,
    profile,
    requestAttachmentEffect,
    attachmentPendingEffect,
    reviewAttachments,
    readRuntimeEffect,
    refreshRuntimeEffect,
    finishAttachmentEffect,
  } = useRuntime()
  const { colors, styles } = useTheme()
  const [entries, setEntries] = useApplicationState<AttachmentArchiveEntry[] | null>(null)
  const [folder, setFolder] = useApplicationState('')
  const [path, setPath] = useApplicationState<string | null>(null)
  const [selected, setSelected] = useApplicationState<AttachmentArchiveFile | null>(null)
  const [loadError, setLoadError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const [added, setAdded] = useApplicationState(false)
  const { busy, error, act } = useAction()
  const uploadIds = useRef(new Map<string, string>())
  const heldUploads = useRef(new Set<string>())
  const attachedUploads = useRef(new Set<string>())
  const scopeKey = JSON.stringify([
    taskId,
    profile?.id,
    profile?.connection.address,
    profile?.connection.token,
    path,
    !!disabled,
  ])
  const owner = useRef({ key: scopeKey, generation: 0, mounted: true })
  if (owner.current.key !== scopeKey) {
    owner.current.key = scopeKey
    owner.current.generation++
  }
  const close = () => {
    owner.current.mounted = false
    onClose()
  }
  useEffect(() => {
    owner.current.mounted = true
    return () => {
      owner.current.mounted = false
    }
  }, [])
  const current = selected?.path === path ? selected : null
  useEffect(() => {
    setEntries(null)
    setLoadError('')
    if (!connected) return
    const requests = clientTaskScope()
    let cancelled = false
    void requests.run(
      readEffect(
        '/api/attachments/archive/list',
        { taskId, id: attachment.id },
        attachmentArchiveListSchema,
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (!cancelled) setEntries(result.entries)
          }),
        ),
        Effect.catch((reason) =>
          Effect.sync(() => {
            if (!cancelled) setLoadError(reason.message)
          }),
        ),
      ),
    )
    return () => {
      cancelled = true
      void requests.stop()
    }
  }, [taskId, attachment.id, connected, readEffect, retry])
  useEffect(() => {
    setSelected(null)
    setLoadError('')
    setAdded(!!path && (heldUploads.current.has(path) || attachedUploads.current.has(path)))
    if (!path || !connected) return
    const requests = clientTaskScope()
    let cancelled = false
    void requests.run(
      readEffect(
        '/api/attachments/archive/read',
        { taskId, id: attachment.id, path },
        attachmentArchiveReadSchema,
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (!cancelled) setSelected(result)
          }),
        ),
        Effect.catch((reason) =>
          Effect.sync(() => {
            if (!cancelled) setLoadError(reason.message)
          }),
        ),
      ),
    )
    return () => {
      cancelled = true
      void requests.stop()
    }
  }, [taskId, attachment.id, path, connected, readEffect, retry])

  const share = () =>
    act(() =>
      mobileWorkflow(function* () {
        const source =
          current ??
          (yield* callEffect(
            '/api/attachments/read',
            { taskId, id: attachment.id },
            attachmentReadSchema,
          ))
        const name = 'attachment' in source ? source.attachment.name : source.name
        const mime = 'attachment' in source ? source.attachment.mime : source.mime
        yield* nativeEffect(() => shareAttachment(name, mime, source.data))
      }),
    )

  return (
    <SafeModal visible animationType="slide" onRequestClose={close}>
      <View style={styles.screen}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }}>
          {(path || folder) && (
            <IconButton
              label={path ? 'Back to archive folder' : 'Parent archive folder'}
              icon="back"
              variant="glass"
              onPress={() => {
                if (path) setPath(null)
                else
                  setFolder(
                    folder.slice(0, -1).split('/').slice(0, -1).join('/') +
                      (folder.slice(0, -1).includes('/') ? '/' : ''),
                  )
              }}
            />
          )}
          <Text
            numberOfLines={1}
            ellipsizeMode="middle"
            style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: '600' }}
          >
            {path ?? (folder || attachment.name)}
          </Text>
          <IconButton
            label={current ? 'Share selected file' : 'Share ZIP'}
            icon="share"
            variant="glass"
            disabled={!connected || busy}
            onPress={share}
          />
          <IconButton label="Close archive" icon="close" variant="glass" onPress={close} />
        </View>
        {(loadError || error || !connected) && (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Text accessibilityRole="alert" style={styles.error}>
              {!connected ? 'Reconnect to browse this ZIP.' : loadError || error}
            </Text>
            {!!loadError && connected && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry archive"
                onPress={() => setRetry((value) => value + 1)}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ color: colors.text }}>Retry</Text>
              </Pressable>
            )}
          </View>
        )}
        {path ? (
          current ? (
            <>
              <ScrollView
                accessibilityLabel="Archive file preview"
                style={{ flex: 1, minHeight: 0 }}
                contentContainerStyle={{ padding: 16 }}
              >
                {imageMimeTypes.has(current.mime) ? (
                  <Image
                    source={{ uri: `data:${current.mime};base64,${current.data}` }}
                    accessibilityLabel={current.name}
                    resizeMode="contain"
                    style={{ width: '100%', height: 360 }}
                  />
                ) : (
                  <Text selectable style={styles.text}>
                    {archiveTextPreview(current)}
                  </Text>
                )}
              </ScrollView>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  added
                    ? heldUploads.current.has(current.path)
                      ? 'Check saved uploads'
                      : 'Attached to draft'
                    : 'Attach selected file to draft'
                }
                disabled={!connected || busy || added || disabled}
                onPress={() => {
                  onBusy?.(true)
                  act(() =>
                    mobileWorkflow(function* () {
                      const generation = owner.current.generation
                      let id = uploadIds.current.get(current.path)
                      if (!id) {
                        id = randomUUID()
                        uploadIds.current.set(current.path, id)
                      }
                      if (!profile) throw new Error('Connect a computer first.')
                      const { guard } = yield* readRuntimeEffect(
                        profile,
                        '/api/attachments/draft-guard',
                        { taskId },
                        mutableStruct({ guard: Schema.String }),
                      )
                      const result = yield* Effect.result(
                        requestAttachmentEffect(
                          profile,
                          { taskId, id, name: current.name, data: current.data, detached: true },
                          false,
                        ),
                      )
                      if (result._tag === 'Failure') {
                        const pending = yield* Effect.result(attachmentPendingEffect(profile, id))
                        if (pending._tag === 'Failure' || pending.success) {
                          heldUploads.current.add(current.path)
                          setAdded(true)
                          reviewAttachments(profile)
                        }
                        return yield* Effect.fail(result.failure)
                      }
                      const sameOwner =
                        owner.current.mounted && owner.current.generation === generation
                      const committed = sameOwner
                        ? yield* Effect.result(
                            readRuntimeEffect(
                              profile,
                              '/api/attachments/commit-upload',
                              { id, guard },
                              attachmentCommitResultSchema,
                            ),
                          )
                        : null
                      if (!committed || committed._tag === 'Failure') {
                        heldUploads.current.add(current.path)
                        setAdded(true)
                        reviewAttachments(profile)
                      } else {
                        attachedUploads.current.add(current.path)
                        setAdded(true)
                        yield* refreshRuntimeEffect(profile).pipe(Effect.catch(() => Effect.void))
                        yield* finishAttachmentEffect(profile, id).pipe(
                          Effect.catch(() => Effect.sync(() => reviewAttachments(profile))),
                        )
                      }
                    }).pipe(Effect.ensuring(Effect.sync(() => onBusy?.(false)))),
                  )
                }}
                style={{
                  minHeight: 48,
                  margin: 16,
                  paddingHorizontal: 16,
                  justifyContent: 'center',
                  borderRadius: 10,
                  backgroundColor: colors.selection,
                  opacity: busy || added ? 0.6 : 1,
                }}
              >
                <Text style={{ color: colors.text }}>
                  {added
                    ? heldUploads.current.has(current.path)
                      ? 'Check saved uploads'
                      : 'Attached to draft'
                    : 'Attach to draft'}
                </Text>
              </Pressable>
            </>
          ) : !loadError && connected ? (
            <Text style={[styles.text, { padding: 16 }]}>Loading file…</Text>
          ) : null
        ) : entries ? (
          <ScrollView accessibilityLabel="Archive files" style={{ flex: 1, minHeight: 0 }}>
            {archiveChildren(entries, folder).map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                accessibilityLabel={`${entry.directory ? 'Open folder' : 'Preview file'} ${entry.path.slice(folder.length).replace(/\/$/, '')}`}
                disabled={!connected || busy}
                onPress={() => (entry.directory ? setFolder(entry.path) : setPath(entry.path))}
                style={{
                  minHeight: 48,
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Icon name={entry.directory ? 'folder' : 'file'} size={20} color={colors.muted} />
                <Text numberOfLines={1} style={{ flex: 1, color: colors.text }}>
                  {entry.path.slice(folder.length).replace(/\/$/, '')}
                </Text>
                {!entry.directory && (
                  <Text style={{ color: colors.muted, fontSize: 11 }}>
                    {fileSizeLabel(entry.size)}
                  </Text>
                )}
              </Pressable>
            ))}
            {!archiveChildren(entries, folder).length && (
              <Text style={[styles.text, { padding: 16 }]}>This folder is empty.</Text>
            )}
          </ScrollView>
        ) : !loadError && connected ? (
          <Text style={[styles.text, { padding: 16 }]}>Loading archive…</Text>
        ) : null}
      </View>
    </SafeModal>
  )
}

function archiveTextPreview(file: AttachmentArchiveFile) {
  try {
    const data = Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    if (!text.includes('\0'))
      return text.slice(0, 32000) + (text.length > 32000 ? '\n… Preview truncated' : '')
  } catch {
    // Binary files remain available through the native share sheet.
  }
  return 'Share this file to open it in another app.'
}
