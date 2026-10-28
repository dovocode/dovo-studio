import { blockAccessibleNotificationInputs } from '../../notifications/visibility'
import { createDraftStash, restoreStashedText, type StashedDraft } from '@dovo/protocol'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { IconButton } from '../../ui/controls/icon-button'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'

const stash = createDraftStash({
  getAllKeys: () => AsyncStorage.getAllKeys(),
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
})

export function DraftStash(props: {
  scope?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  getText: () => string
  onChange: (text: string) => void
  focus: () => void
  hasAttachments: boolean
  disabled?: boolean
}) {
  const { styles } = useTheme()
  const [localOpen, setLocalOpen] = useState(false)
  const open = props.open ?? localOpen
  const setOpen = props.onOpenChange ?? setLocalOpen
  useLayoutEffect(() => {
    if (open) return blockAccessibleNotificationInputs()
  }, [open])
  const [entries, setEntries] = useState<StashedDraft[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const latest = useRef(props)
  latest.current = props
  const sheet = useRef<SheetHandle>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    if (!open || !props.scope) return
    let cancelled = false
    setError('')
    setBusy(true)
    void stash.list(props.scope).then(
      (rows) => {
        if (!cancelled) {
          setEntries(rows)
          setBusy(false)
        }
      },
      () => {
        if (!cancelled) {
          setError('Could not read stashed drafts. Your saved data was kept.')
          setBusy(false)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [open, props.scope])
  const save = async () => {
    if (!props.scope || busy || props.disabled || props.hasAttachments) return
    const text = props.getText()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      await stash.save(props.scope, { id: randomUUID(), text, createdAt: Date.now() })
      if (!active.current) return
      const current = latest.current
      if (!current.disabled && !current.hasAttachments && current.getText() === text)
        current.onChange('')
      const rows = await stash.list(props.scope)
      if (active.current) setEntries(rows)
    } catch (cause) {
      if (active.current)
        setError(cause instanceof Error ? cause.message : 'Could not stash this draft.')
    } finally {
      if (active.current) setBusy(false)
    }
  }
  const remove = async (id: string) => {
    if (!props.scope || busy) return
    setBusy(true)
    setError('')
    try {
      await stash.remove(props.scope, id)
      const rows = await stash.list(props.scope)
      if (active.current) setEntries(rows)
    } catch {
      if (active.current) setError('Could not delete the saved draft.')
    } finally {
      if (active.current) setBusy(false)
    }
  }
  return (
    <>
      {props.open === undefined && (
        <IconButton
          icon="archive"
          label="Stashed drafts"
          disabled={props.disabled || !props.scope}
          onPress={() => {
            setOpen(true)
          }}
        />
      )}
      {open && (
        <Sheet ref={sheet} title="Stashed drafts" onClose={() => setOpen(false)}>
          <Text style={styles.muted}>
            Text saved on this device for this thread. Restoring appends to your draft and keeps a
            saved copy.
          </Text>
          {props.hasAttachments && (
            <Text style={styles.muted}>
              Remove attachments before stashing or restoring a text draft.
            </Text>
          )}
          <Action
            label="Stash current text"
            disabled={busy || props.disabled || props.hasAttachments || !props.getText().trim()}
            onPress={() => void save()}
          />
          {!busy && !entries.length && <Text style={styles.muted}>No stashed drafts yet.</Text>}
          {entries.map((entry) => (
            <View key={entry.id} style={{ gap: 8, paddingVertical: 12 }}>
              <Text numberOfLines={3}>{entry.text}</Text>
              <Text style={styles.muted}>{new Date(entry.createdAt).toLocaleString()}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Action
                  secondary
                  label="Restore"
                  disabled={busy || props.disabled || props.hasAttachments}
                  onPress={() => {
                    const current = latest.current
                    if (current.disabled || current.hasAttachments) return
                    try {
                      current.onChange(restoreStashedText(current.getText(), entry.text))
                      sheet.current?.dismiss(current.focus)
                    } catch {
                      setError('Could not restore the draft. The saved copy was kept.')
                    }
                  }}
                />
                <Action
                  secondary
                  label="Delete stashed draft"
                  disabled={busy}
                  onPress={() => void remove(entry.id)}
                />
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
    </>
  )
}
