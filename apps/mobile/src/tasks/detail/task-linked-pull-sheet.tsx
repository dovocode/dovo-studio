import { useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { forgePullTarget, pullRepositoryIdentity, taskPullLinks, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
import { Text } from '../../ui/content/text'
import { PullRequestIcon } from '../../ui/content/pull-request-icon'
import { useLinkOrigin } from '../../ui/content/link-origin'
import { openAppLink } from '../../ui/content/open-link'
import { useTheme } from '../../ui/theme'
import { PullDetail } from '../../scm/pulls/detail/pull-detail'

export function TaskLinkedPullSheet({
  task,
  initialUrl,
  onClose,
}: {
  task: Task
  initialUrl?: string
  onClose: () => void
}) {
  const origin = useLinkOrigin(task.id)
  const { snapshot } = useRuntime()
  const { colors, styles } = useTheme()
  const [error, setError] = useState('')
  const links = taskPullLinks(task)
  const sheet = useRef<SheetHandle>(null)
  const destination = (url: string) => {
    const repositories = snapshot?.workspace.repositories.filter((repo) => !repo.kind) ?? []
    const target = forgePullTarget(
      url,
      repositories.map((repo) => ({ identity: pullRepositoryIdentity(repo) })),
    )
    const matches = target
      ? repositories.filter((repo) => pullRepositoryIdentity(repo) === target.identity)
      : []
    const repository =
      matches.find((repo) => repo.id === task.repositoryId) ??
      (matches.length === 1 ? matches[0] : undefined)
    if (matches.length > 1 && !repository) return null
    return target
      ? {
          repositoryId: repository?.id ?? target.url,
          number: target.number,
          tab: target.tab,
          fragment: target.fragment,
          navigationUrl: target.navigationUrl,
        }
      : null
  }
  const [selected, setSelected] = useState(() => (initialUrl ? destination(initialUrl) : null))
  const open = (url: string) => {
    const target = destination(url)
    if (target) setSelected(target)
    else {
      setError('')
      sheet.current?.dismiss(() => {
        void openAppLink(url, false, origin).catch((cause) => setError(String(cause)))
      })
    }
  }
  return (
    <Sheet ref={sheet} title="Linked pull requests" scrollable={!selected} onClose={onClose}>
      {selected ? (
        <PullDetail
          key={`${selected.repositoryId}:${selected.number}`}
          repositoryId={selected.repositoryId}
          number={selected.number}
          initialTab={selected.tab}
          initialFragment={selected.fragment}
          initialNavigationUrl={selected.navigationUrl}
          backLabel="Back to linked PRs"
          embedded
          onBack={() => setSelected(null)}
        />
      ) : (
        <View style={{ gap: 12 }}>
          {links.map((pull) => (
            <Pressable
              key={pull.url}
              accessibilityRole="button"
              accessibilityLabel={`Open PR #${pull.number}: ${pull.title}`}
              onPress={() => open(pull.url)}
              style={[
                styles.card,
                {
                  borderRadius: 24,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 16,
                },
              ]}
            >
              <PullRequestIcon
                state={task.pullStatus?.url === pull.url ? task.pullStatus.state : undefined}
                draft={task.pullStatus?.url === pull.url ? task.pullStatus.draft : undefined}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text numberOfLines={2} style={{ color: colors.text, fontSize: 16 }}>
                  {pull.title}
                </Text>
                <Text numberOfLines={1} style={styles.muted}>
                  #{pull.number} · {pull.repositoryUrl.replace(/^https?:\/\//, '')}
                </Text>
              </View>
            </Pressable>
          ))}
          {!links.length && (
            <Text style={styles.muted}>No pull requests linked to this thread.</Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      )}
    </Sheet>
  )
}
