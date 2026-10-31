import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { responses, type LocalCommit } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'

export function LocalCommitPicker({
  taskId,
  checkoutId,
  disabled,
  onSelect,
}: {
  taskId: string
  checkoutId?: string
  disabled?: boolean
  onSelect: (commit: LocalCommit) => void
}) {
  const { read, connected, connection } = useRuntime()
  const { styles } = useTheme()
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState<string>()
  const [retry, setRetry] = useState(0)
  const owner = JSON.stringify([
    connection?.address,
    connection?.token,
    taskId,
    checkoutId,
    cursor,
    retry,
  ])
  const [result, setResult] = useState<{
    key: string
    commits: LocalCommit[]
    hasMore: boolean
    error: string
  }>()
  const current = result?.key === owner ? result : undefined
  useEffect(() => {
    if (!open || !connected) return
    let active = true
    void read(
      '/api/tasks/commits/read',
      { id: taskId, checkoutId, sha: cursor },
      responses.localCommits,
    ).then(
      (page) => {
        if (active) setResult({ ...page, key: owner, error: '' })
      },
      (error: unknown) => {
        if (active)
          setResult({
            key: owner,
            commits: [],
            hasMore: false,
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      active = false
    }
  }, [open, connected, read, owner, taskId, checkoutId, cursor])
  return (
    <>
      <Action
        secondary
        label="Local commits"
        disabled={disabled || !connected}
        onPress={() => {
          setCursor(undefined)
          setRetry((value) => value + 1)
          setOpen(true)
        }}
      />
      {open && (
        <Sheet title="Review a local commit" onClose={() => setOpen(false)}>
          <Text style={styles.muted}>
            Changes against the first parent. Merge commits use their first parent.
          </Text>
          <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
            {current?.error ? (
              <View>
                <Text accessibilityRole="alert" style={styles.error}>
                  {current.error}
                </Text>
                <Action
                  secondary
                  label="Retry commit list"
                  onPress={() => setRetry((value) => value + 1)}
                />
              </View>
            ) : !current ? (
              <Text>Loading commits…</Text>
            ) : !current.commits.length ? (
              <Text>No commits in this checkout.</Text>
            ) : (
              current.commits.map((commit) => (
                <View key={commit.sha} style={{ paddingVertical: 6 }}>
                  <Action
                    secondary
                    label={`${commit.sha.slice(0, 8)} · ${commit.subject || '(no subject)'}`}
                    onPress={() => {
                      onSelect(commit)
                      setOpen(false)
                    }}
                  />
                  <Text style={styles.muted}>
                    {commit.author} · {new Date(commit.date).toLocaleDateString()}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
          {current?.hasMore && current.commits.at(-1)?.parents[0] && (
            <Action
              secondary
              label="Older commits"
              onPress={() => setCursor(current.commits.at(-1)?.parents[0])}
            />
          )}
        </Sheet>
      )}
    </>
  )
}
