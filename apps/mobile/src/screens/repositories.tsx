import { mobileWorkflow } from '../runtime/native-effect'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { validationMessages } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Sheet } from '../ui/sheet'
import { useNavigation } from '../shell/navigation'
import { RepositoryCheckouts } from '../scm/repository-checkouts'
import { DirectoryPicker } from '../scm/directory-picker'
import { GithubRepositoryPicker } from '../scm/github-repository-picker'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { addRepositorySchema, repositorySchema } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { CreationTarget } from '../runtime/creation-target'
import { clientScopeKey } from '@dovo/client-runtime'
import { ScreenHeader } from '../ui/screen-header'
import { IconButton } from '../ui/icon-button'
export default function RepositoriesScreen() {
  const { navigate } = useNavigation()
  const { overviews } = useRuntime()
  const [adding, setAdding] = useApplicationState(false)
  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Projects"
        leading={
          <IconButton
            label="Back to tasks"
            icon="back"
            variant="glass"
            onPress={() => navigate('tasks')}
          />
        }
        buttons={[
          {
            label: 'Add repository',
            icon: 'add',
            onPress: () => setAdding(true),
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {adding && (
          <CreationTarget title="Add project" onClose={() => setAdding(false)}>
            {() => <AddProject onClose={() => setAdding(false)} />}
          </CreationTarget>
        )}

        {overviews.map((entry) => (
          <RuntimeScope key={clientScopeKey(entry.profile.connection)} runtimeId={entry.profile.id}>
            <Text style={styles.muted}>
              {entry.profile.name}
              {entry.connected ? '' : ' · Offline'}
            </Text>
            {entry.snapshot?.workspace.repositories.map((repository) => (
              <RepositoryCheckouts key={repository.id} repository={repository} />
            ))}
          </RuntimeScope>
        ))}
      </ScrollView>
    </View>
  )
}
function AddProject({ onClose }: { onClose: () => void }) {
  const { profile, connected, connection, callEffect } = useRuntime(),
    { busy, error, act } = useAction(),
    [name, setName] = useApplicationState(''),
    [path, setPath] = useApplicationState(''),
    [source, setSource] = useApplicationState<'local' | 'github'>('local'),
    [repository, setRepository] = useApplicationState(''),
    [directory, setDirectory] = useApplicationState(''),
    [picker, setPicker] = useApplicationState<'directory' | 'github' | null>(null)
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
            setPicker(null)
          }}
        />
      ) : picker === 'github' ? (
        <GithubRepositoryPicker
          key={connection?.address}
          onClose={() => setPicker(null)}
          onSelect={(selected) => {
            setRepository(selected.fullName)
            if (!name.trim()) setName(selected.name)
            setPicker(null)
          }}
        />
      ) : (
        <>
          <Text style={styles.muted}>{profile?.name}</Text>
          <View style={styles.row}>
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
          <Text style={styles.muted}>Choose a folder on this computer.</Text>
          <Field label="Repository name" value={name} onChangeText={setName} editable={!busy} />
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
                : source === 'github'
                  ? 'Clone and add repository'
                  : 'Add repository'
            }
            disabled={
              !connected ||
              busy ||
              !name.trim() ||
              !(source === 'local' ? path.trim() : directory.trim() && repository.trim())
            }
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  const input =
                    source === 'local'
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
                  yield* callEffect('/api/scm/repositories/add', input, repositorySchema)
                  onClose()
                  setName('')
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
