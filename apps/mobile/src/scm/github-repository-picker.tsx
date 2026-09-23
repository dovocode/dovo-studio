import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { useEffect } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import {
  githubRepositoryPageSchema,
  type GithubRepositoryChoice,
  type GithubRepositoryPage,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
export function GithubRepositoryPicker({
  onSelect,
  onClose,
}: {
  onSelect: (repository: GithubRepositoryChoice) => void
  onClose: () => void
}) {
  const { call, connected, callEffect } = useRuntime()
  const [load, setLoad] = useApplicationState({
    page: 1,
  })
  const [data, setData] = useApplicationState<GithubRepositoryPage | null>(null)
  const [filter, setFilter] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(true)
  const [error, setError] = useApplicationState('')
  useEffect(() => {
    let active = true
    setBusy(true)
    setError('')
    void runClientEffect(
      callEffect('/api/scm/repositories/github/read', load, githubRepositoryPageSchema)
        .pipe(
          Effect.flatMap((result) =>
            nativeEffect(() => {
              if (active)
                setData((previous) => ({
                  ...result,
                  repositories:
                    load.page === 1
                      ? result.repositories
                      : [
                          ...new Map(
                            [...(previous?.repositories ?? []), ...result.repositories].map(
                              (repo) => [repo.fullName, repo],
                            ),
                          ).values(),
                        ],
                }))
            }),
          ),
        )
        .pipe(
          Effect.catchAll((error: unknown) =>
            nativeEffect(() => {
              if (active) setError(error instanceof Error ? error.message : String(error))
            }),
          ),
        )
        .pipe(
          Effect.ensuring(
            nativeEffect(() => {
              if (active) setBusy(false)
            }).pipe(Effect.orDie),
          ),
        ),
    )
    return () => {
      active = false
    }
  }, [load, call])
  const repositories =
    data?.repositories.filter((repo) =>
      `${repo.fullName} ${repo.description}`.toLowerCase().includes(filter.toLowerCase().trim()),
    ) ?? []
  return (
    <View
      style={{
        gap: 12,
      }}
    >
      <Text style={styles.text}>Choose a GitHub repository</Text>
      <Text style={styles.muted}>
        Uses the runtime host’s GitHub login, including accessible organization repositories.
        Selecting fills the form; it does not start cloning.
      </Text>
      <Field
        label="Filter loaded repositories"
        value={filter}
        onChangeText={setFilter}
        placeholder="Repository or organization name"
      />
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Action
            label="Retry"
            secondary
            disabled={busy || !connected}
            onPress={() =>
              setLoad({
                ...load,
              })
            }
          />
        </>
      )}
      <ScrollView
        style={{
          maxHeight: 350,
        }}
        contentContainerStyle={{
          gap: 8,
        }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {repositories.map((repo) => (
          <View
            key={repo.fullName}
            style={{
              gap: 4,
            }}
          >
            <Action
              label={`${repo.fullName} · ${repo.private ? 'Private' : 'Public'}`}
              secondary
              disabled={busy || !connected}
              onPress={() => onSelect(repo)}
            />
            {!!repo.description && (
              <Text numberOfLines={2} style={styles.muted}>
                {repo.description}
              </Text>
            )}
          </View>
        ))}
        {!busy && !error && !repositories.length && (
          <Text style={styles.muted}>
            {data?.repositories.length
              ? 'No matches in loaded repositories. Load more or change the filter.'
              : 'No accessible repositories found.'}
          </Text>
        )}
      </ScrollView>
      {busy && <Text style={styles.muted}>Loading GitHub repositories…</Text>}
      {data && (
        <Text style={styles.muted}>
          {data.repositories.length} loaded
          {data.nextPage !== null ? ' · More available' : ' · All loaded'}
        </Text>
      )}
      {data?.nextPage != null && (
        <Action
          label="Load more"
          secondary
          disabled={busy || !connected}
          onPress={() => {
            if (data.nextPage !== null)
              setLoad({
                page: data.nextPage,
              })
          }}
        />
      )}
      <Action label="Back" secondary onPress={onClose} />
    </View>
  )
}
