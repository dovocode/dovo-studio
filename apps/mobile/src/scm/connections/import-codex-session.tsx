import { useRef, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { useCodexSessionImport } from '@dovo/studio-core'
import { useRuntime } from '../../runtime/connection/provider'
import { Sheet, useSheetNavigation, type SheetHandle } from '../../ui/layout/sheet'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { taskHref } from '../../shell/task-route'

export function ImportCodexSession({
  repositoryId,
  disabled,
}: {
  repositoryId: string
  disabled?: boolean
}) {
  const runtime = useRuntime()
  const { styles } = useTheme()
  const [open, setOpen] = useState(false)
  const sheet = useRef<SheetHandle>(null)
  const navigateFromSettings = useSheetNavigation()
  const picker = useCodexSessionImport(runtime.call, repositoryId, open)
  const navigate = (id: string) => {
    const runtimeId = runtime.profile?.id
    if (runtimeId)
      sheet.current?.dismiss(() => navigateFromSettings(() => router.push(taskHref(runtimeId, id))))
  }
  return (
    <>
      <Action
        secondary
        label="Import Codex terminal session"
        disabled={disabled || !runtime.connected}
        onPress={() => {
          picker.refresh()
          setOpen(true)
        }}
      />
      {open && (
        <Sheet
          ref={sheet}
          title="Import Codex terminal session"
          busy={picker.importing}
          onClose={() => setOpen(false)}
        >
          <Text style={styles.muted}>
            Preview a session from this project on the selected computer. Exit Codex before
            importing. Send a new message after import to continue.
          </Text>
          <Choice
            label="Codex configuration"
            value={picker.agentId}
            disabled={picker.importing}
            onChange={picker.setAgentId}
            items={[
              { id: '', name: 'Project / default Codex home' },
              ...(runtime.snapshot?.workspace.agents ?? [])
                .filter((agent) => agent.provider === 'codex')
                .map((agent) => ({ id: agent.id, name: agent.name })),
            ]}
          />
          <Action
            secondary
            label="Refresh sessions"
            disabled={picker.importing}
            onPress={picker.refresh}
          />
          {!!picker.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {picker.error}
            </Text>
          )}
          {!!picker.notice && <Text style={styles.muted}>{picker.notice}</Text>}
          {!picker.sessions ? (
            <Text style={styles.muted}>Finding Codex sessions…</Text>
          ) : !picker.sessions.length ? (
            <Text style={styles.muted}>
              No terminal Codex sessions found for this project and configuration.
            </Text>
          ) : (
            picker.sessions.map((session) => (
              <View key={session.key} style={{ gap: 4, marginVertical: 6 }}>
                <Action
                  secondary
                  label={`${session.title}${session.taskId ? ' · In Dovo' : ''}`}
                  disabled={picker.importing}
                  onPress={() => picker.select(session.key)}
                />
                <Text style={styles.muted}>
                  {session.cwd} · {new Date(session.updatedAt).toLocaleString()}
                </Text>
              </View>
            ))
          )}
          {!!picker.selected && !picker.preview && !picker.error && (
            <Text style={styles.muted}>Loading session preview…</Text>
          )}
          {!!picker.preview && (
            <View accessibilityLabel="Codex session preview" style={{ gap: 12 }}>
              <Text style={styles.muted}>
                {picker.preview.session.model || 'Native model'} ·{' '}
                {picker.preview.session.sessionId}
              </Text>
              <Text style={styles.text}>{picker.preview.notice}</Text>
              {!!picker.preview.olderMessages && (
                <Text style={styles.muted}>
                  Showing the latest 100 messages. All{' '}
                  {picker.preview.olderMessages + picker.preview.messages.length} messages will be
                  saved.
                </Text>
              )}
              {picker.preview.messages.map((message) => (
                <View key={message.id} style={{ gap: 4 }}>
                  <Text style={styles.muted}>
                    {message.role === 'user' ? 'You · Imported' : 'Codex'}
                  </Text>
                  <Text selectable style={styles.text}>
                    {message.text}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {picker.preview?.session.taskId ? (
            <Action
              label="Open existing thread"
              onPress={() => {
                const id = picker.preview?.session.taskId
                if (id) navigate(id)
              }}
            />
          ) : (
            <Action
              label={picker.importing ? 'Importing…' : 'Import session'}
              disabled={
                picker.importing ||
                picker.preview?.status !== 'available' ||
                !picker.preview.messages.length ||
                !runtime.connected
              }
              onPress={() => {
                void picker.importSession().then((result) => {
                  if (result) navigate(result.id)
                })
              }}
            />
          )}
        </Sheet>
      )}
    </>
  )
}
