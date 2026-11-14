import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

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
        label={uiText('Local commits')}
        disabled={disabled || !connected}
        onPress={() => {
          setCursor(undefined)
          setRetry((value) => value + 1)
          setOpen(true)
        }}
      />
      {open && (
        <Sheet title={uiText('Review a local commit')} onClose={() => setOpen(false)}>
          <Text style={styles.muted}>
            <InterfaceText>
              {'Changes against the first parent. Merge commits use their first parent.'}
            </InterfaceText>
          </Text>
          <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
            {current?.error ? (
              <View>
                <Text accessibilityRole="alert" style={styles.error}>
                  {current.error}
                </Text>
                <Action
                  secondary
                  label={uiText('Retry commit list')}
                  onPress={() => setRetry((value) => value + 1)}
                />
              </View>
            ) : !current ? (
              <Text>
                <InterfaceText>{'Loading commits…'}</InterfaceText>
              </Text>
            ) : !current.commits.length ? (
              <Text>
                <InterfaceText>{'No commits in this checkout.'}</InterfaceText>
              </Text>
            ) : (
              current.commits.map((commit) => (
                <View key={commit.sha} style={{ paddingVertical: 6 }}>
                  <Action
                    secondary
                    label={`${commit.sha.slice(0, 8)} · ${commit.subject || uiText('(no subject)')}`}
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
              label={uiText('Older commits')}
              onPress={() => setCursor(current.commits.at(-1)?.parents[0])}
            />
          )}
        </Sheet>
      )}
    </>
  )
}
