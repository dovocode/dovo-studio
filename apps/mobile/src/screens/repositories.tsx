import { contentColumn } from '../ui/layout/content-column'
import { EmptyState } from '../ui/content/empty-state'
import { useNavigation } from '../shell/navigation'
import { runtimeComputerName } from '@dovo/protocol'
import { mobileWorkflow } from '../runtime/state/native-effect'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/state/application-state'
import { validationMessages } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Sheet } from '../ui/layout/sheet'
import { backToCollection } from '../shell/source-route'
import { RepositoryCheckouts } from '../scm/connections/repository-checkouts'
import { DirectoryPicker } from '../scm/connections/directory-picker'
import { GithubRepositoryPicker } from '../scm/connections/github-repository-picker'
import { suggestedProjectName } from '../scm/connections/project-name'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/content/text'
import { addRepositorySchema, repositorySchema } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Field } from '../ui/controls/field'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { CreationTarget } from '../runtime/connection/creation-target'
import { clientScopeKey } from '@dovo/client-runtime'
import { ScreenHeader } from '../ui/layout/screen-header'
import { DeleteProjectAction } from '../scm/connections/project-deletion'
export default function RepositoriesScreen() {
  const { styles } = useTheme()

  const { overviews } = useRuntime()
  const { navigate } = useNavigation()
  const [adding, setAdding] = useApplicationState(false)
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Projects"
        onBack={() => backToCollection('/')}
        buttons={[
          {
            label: 'Add project',
            icon: 'add',
            disabled: !overviews.some((entry) => entry.connected && entry.snapshot),
            onPress: () => setAdding(true),
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={[styles.content, contentColumn.collection]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {adding && (
          <CreationTarget title="Add project" onClose={() => setAdding(false)}>
            {() => <AddProject onClose={() => setAdding(false)} />}
          </CreationTarget>
        )}

        {!overviews.length && (
          <EmptyState
            icon="projects"
            title="Connect a computer"
            description="Link a computer to see its projects and start working with files and threads."
            action={<Action label="Open computer settings" onPress={() => navigate('settings')} />}
          />
        )}

        {overviews.map((entry) => (
          <RuntimeScope key={clientScopeKey(entry.profile.connection)} runtimeId={entry.profile.id}>
            <Text accessibilityRole="header" style={styles.muted}>
              {runtimeComputerName(entry)}
              {entry.connected ? '' : ' · Offline'}
            </Text>
            {!entry.snapshot?.workspace.repositories.length && (
              <EmptyState
                icon="projects"
                title={
                  entry.connected
                    ? entry.snapshot
                      ? 'No projects yet'
                      : 'Loading projects…'
                    : 'Projects unavailable'
                }
                description={
                  entry.connected && entry.snapshot
                    ? 'Add a project to start working with files and threads on this computer.'
                    : entry.connected
                      ? 'Loading projects from this computer.'
                      : 'Connect this computer to load its projects.'
                }
                action={
                  entry.connected &&
                  !!entry.snapshot &&
                  overviews.length === 1 && (
                    <Action label="Add project" onPress={() => setAdding(true)} />
                  )
                }
              />
            )}
            {entry.snapshot?.workspace.repositories.map((repository) => (
              <View key={repository.id} style={{ gap: 8 }}>
                <RepositoryCheckouts repository={repository} />
                {repository.kind !== 'scratch' && <DeleteProjectAction repository={repository} />}
              </View>
            ))}
          </RuntimeScope>
        ))}
      </ScrollView>
    </View>
  )
}

export function AddProject({
  onClose,
  initialSource = 'dovo',
  onAdded,
}: {
  onClose: () => void
  initialSource?: 'dovo' | 'local' | 'github'
  onAdded?: (repository: import('@dovo/protocol').Repository) => void
}) {
  const { styles } = useTheme()

  const { profile, snapshot, connected, connection, callEffect } = useRuntime(),
    { busy, error, act } = useAction(),
    [customName, setName] = useApplicationState<string | null>(null),
    [path, setPath] = useApplicationState(''),
    [source, setSource] = useApplicationState<'dovo' | 'local' | 'github'>(initialSource),
    [repository, setRepository] = useApplicationState(''),
    [directory, setDirectory] = useApplicationState(''),
    [picker, setPicker] = useApplicationState<'directory' | 'github' | null>(null)
  const name =
    customName ??
    (source === 'dovo' ? '' : suggestedProjectName(source === 'local' ? path : repository))
  return (
    <Sheet
      scrollable={picker !== 'directory'}
      title={
        picker === 'directory'
          ? 'Choose folder'
          : picker === 'github'
            ? 'Choose repository'
            : 'Add project'
      }
      busy={busy}
      onClose={onClose}
    >
      {picker === 'directory' ? (
        <DirectoryPicker
          key={connection?.address}
          initialPath={source === 'local' ? path : directory}
          onClose={() => setPicker(null)}
          onSelect={(selected) => {
            ;(source === 'local' ? setPath : setDirectory)(selected)
            if (source === 'local') setName((current) => (current?.trim() ? current : null))
            setPicker(null)
          }}
        />
      ) : picker === 'github' ? (
        <GithubRepositoryPicker
          key={connection?.address}
          onClose={() => setPicker(null)}
          onSelect={(selected) => {
            setRepository(selected.fullName)
            setName((current) => (current?.trim() ? current : null))
            setPicker(null)
          }}
        />
      ) : (
        <>
          <Text style={styles.muted}>{runtimeComputerName({ profile, snapshot })}</Text>
          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <Action
              label="Dovo Project"
              secondary={source !== 'dovo'}
              disabled={busy}
              onPress={() => setSource('dovo')}
            />
            <Action
              label="Local path"
              secondary={source !== 'local'}
              disabled={busy}
              onPress={() => setSource('local')}
            />
            <Action
              label="GitHub"
              secondary={source !== 'github'}
              disabled={busy}
              onPress={() => setSource('github')}
            />
          </View>
          <Text style={styles.muted}>
            {source === 'dovo'
              ? 'Dovo creates a folder in ~/.dovo/projects on this computer. Chats in this project share its files. No Git setup needed.'
              : 'Choose a folder on this computer.'}
          </Text>
          <Field label="Project name" value={name} onChangeText={setName} editable={!busy} />
          {source === 'github' && (
            <>
              <Field
                label="GitHub repository"
                value={repository}
                onChangeText={setRepository}
                editable={!busy}
                autoCorrect={false}
                placeholder="owner/repo or https://github.com/owner/repo"
              />
              <Action
                label="Choose from GitHub…"
                secondary
                disabled={!connected || busy}
                onPress={() => setPicker('github')}
              />
            </>
          )}
          {source !== 'dovo' && (
            <>
              <Field
                label={
                  source === 'local'
                    ? 'Local path on runtime host'
                    : 'Clone parent folder on runtime host'
                }
                value={source === 'local' ? path : directory}
                onChangeText={source === 'local' ? setPath : setDirectory}
                editable={!busy}
                autoCorrect={false}
                placeholder={source === 'local' ? '~/Code/my-project' : '~/Code'}
              />
              <Action
                label="Browse runtime folders…"
                secondary
                disabled={!connected || busy}
                onPress={() => setPicker('directory')}
              />
            </>
          )}
          {source === 'github' && (
            <Text style={styles.muted}>
              Creates a new folder named after the repository inside this existing parent folder.
              Private repositories require Git credentials on the host.
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={
              busy
                ? 'Working…'
                : source === 'dovo'
                  ? 'Create project'
                  : source === 'github'
                    ? 'Clone and add repository'
                    : 'Add repository'
            }
            disabled={
              !connected ||
              busy ||
              !name.trim() ||
              (source !== 'dovo' &&
                !(source === 'local' ? path.trim() : directory.trim() && repository.trim()))
            }
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  const input =
                    source === 'dovo'
                      ? { source, name }
                      : source === 'local'
                        ? {
                            source,
                            name,
                            path,
                          }
                        : {
                            source,
                            name,
                            repository,
                            directory,
                          }
                  const parsed = decodeResult(addRepositorySchema, input)
                  if (!parsed.success)
                    return yield* Effect.fail(
                      new Error(validationMessages(parsed.error)[0] ?? 'Invalid repository'),
                    )
                  const added = yield* callEffect(
                    '/api/scm/repositories/add',
                    input,
                    repositorySchema,
                  )
                  onAdded?.(added)
                  onClose()
                  setName(null)
                  setPath('')
                  setRepository('')
                  setDirectory('')
                }),
              )
            }
          />
        </>
      )}
    </Sheet>
  )
}
