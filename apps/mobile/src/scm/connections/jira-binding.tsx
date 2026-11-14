import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { runtimeComputerName } from '@dovo/protocol'
import { mobileWorkflow, nativeEffect } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../runtime/state/application-state'
import { validationMessages } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import {
  jiraBindingSchema,
  jiraProjectsSchema,
  responses,
  jiraSourceSchema,
  type JiraSource,
} from '@dovo/protocol'
import { Schema, Effect } from 'effect'
import { useRuntime } from '../../runtime/connection/provider'
import { SettingsAction as Action } from '../../screens/settings-controls'
import { SettingsChoice as Choice } from '../../screens/settings-controls'
import { SettingsField as Field } from '../../screens/settings-controls'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
export function JiraProjectForm({
  initial,
  onClose,
  onSaved,
  onBusyChange,
}: {
  initial?: JiraSource
  onClose: () => void
  onSaved?: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const uiText = useInterfaceText()

  const { styles } = useTheme()

  const { read, connected, profile, snapshot, callEffect, readEffect } = useRuntime()
  const [name, setName] = useApplicationState(initial?.name ?? '')
  const [site, setSite] = useApplicationState(initial?.site ?? '')
  const [project, setProject] = useApplicationState(initial?.project ?? '')
  const [manual, setManual] = useApplicationState(false)
  const [projects, setProjects] = useApplicationState<
    Schema.Schema.Type<typeof jiraProjectsSchema> | undefined
  >(undefined)
  const [loading, setLoading] = useApplicationState(connected)
  const [revision, retry] = useApplicationState(0)
  const [loadError, setLoadError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const hasInitial = !!initial
  useEffect(() => {
    let current = true
    if (!connected) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    void runClientEffect(
      readEffect('/api/scm/jira/projects/read', {}, jiraProjectsSchema)
        .pipe(
          Effect.flatMap((result) =>
            nativeEffect(() => {
              if (!current) return
              setProjects(result)
              if (!hasInitial) setSite(result.site)
            }),
          ),
        )
        .pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              if (current) setLoadError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
        )
        .pipe(
          Effect.ensuring(
            nativeEffect(() => {
              if (current) setLoading(false)
            }).pipe(Effect.orDie),
          ),
        ),
    )
    return () => {
      current = false
    }
  }, [read, connected, revision, hasInitial])
  const save = (remove = false) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || !connected) return
        const parsed = decodeResult(jiraBindingSchema, {
          site: /^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${site.trim()}`,
          project: project.trim().toUpperCase(),
        })
        if (!remove && !parsed.success) {
          setError(validationMessages(parsed.error)[0] ?? uiText('Enter a Jira site and project.'))
          return
        }
        pending.current = true
        setBusy(true)
        onBusyChange(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          if (remove && initial)
            yield* callEffect(
              '/api/scm/jira/sources/remove',
              {
                sourceId: initial.id,
                before: initial,
              },
              responses.ok,
            )
          else
            yield* callEffect(
              '/api/scm/jira/sources/save',
              {
                before: initial,
                source: {
                  ...parsed.data,
                  ...(initial
                    ? {
                        id: initial.id,
                      }
                    : {}),
                  name:
                    name.trim() || projects?.projects.find((entry) => entry.key === project)?.name,
                },
              },
              jiraSourceSchema,
            )
          onSaved?.()
          onClose()
        }).pipe(
          Effect.catch((cause) =>
            nativeEffect(() => {
              setError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              setBusy(false)
              onBusyChange(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  const projectItems =
    projects?.projects.map((entry) => ({
      id: entry.key,
      name: `${entry.key} · ${entry.name}`,
    })) ?? []
  if (initial && !projectItems.some((entry) => entry.id === initial.project))
    projectItems.unshift({
      id: initial.project,
      name: initial.project,
    })
  return (
    <>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Browse Jira independently of your code. Link an issue to a Dovo project when you are ready to work on it.'
          }
        </InterfaceText>
      </Text>
      <View
        style={{
          gap: 4,
        }}
      >
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: runtimeComputerName({ profile, snapshot }) }}>
            {'Signed-in account on {value0}'}
          </InterfaceText>
        </Text>
        <Text selectable style={styles.text}>
          {projects?.site ?? initial?.site ?? uiText('Checking Jira account…')}
        </Text>
      </View>
      {initial && (
        <Field
          label={uiText('Source name')}
          value={name}
          onChangeText={setName}
          editable={!busy}
          placeholder={initial.project}
          maxLength={200}
        />
      )}
      {initial && projects && initial.site !== projects.site && (
        <Text style={styles.muted}>
          <InterfaceText values={{ value0: initial.site, value1: initial.project }}>
            {
              'Current source: {value0} · {value1}. Sign in to this source’s account before editing it.'
            }
          </InterfaceText>
        </Text>
      )}
      {loading && (
        <Text style={styles.muted}>
          <InterfaceText>{'Loading projects…'}</InterfaceText>
        </Text>
      )}
      {!!loadError && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {loadError}
          </Text>
          <Text style={styles.muted}>
            <InterfaceText
              values={{ value0: uiText('On'), value1: runtimeComputerName({ profile, snapshot }) }}
            >
              {'{value0} {value1}, sign in with acli jira auth login, then retry.'}
            </InterfaceText>
          </Text>
          <Action
            secondary
            label={uiText('Retry account')}
            disabled={busy || loading || !connected}
            onPress={() => retry((value) => value + 1)}
          />
        </>
      )}
      {!manual && projectItems.length > 0 && (
        <Choice
          label={uiText('Jira space / project')}
          value={project}
          disabled={busy || loading || !!initial}
          items={[
            {
              id: '',
              name: uiText('Choose a project…'),
            },
            ...projectItems,
          ]}
          onChange={(value) => {
            setProject(value)
            if (projects) setSite(projects.site)
          }}
        />
      )}
      {!loading && !projects?.projects.length && !loadError && (
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'No projects were returned by this account. Enter a project key below if you have access.'
            }
          </InterfaceText>
        </Text>
      )}
      {(manual || (!loading && !projectItems.length)) && (
        <>
          <Field
            label={uiText('Jira Cloud site')}
            value={site}
            onChangeText={setSite}
            keyboardType="url"
            autoCorrect={false}
            editable={!busy && !initial}
            placeholder={uiText('team.atlassian.net')}
          />
          <Field
            label={uiText('Project key')}
            value={project}
            onChangeText={(value) => setProject(value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy && !initial}
            placeholder={uiText('TEAM')}
          />
        </>
      )}
      {!initial && !manual && projectItems.length > 0 && (
        <Action
          secondary
          label={uiText('Enter project manually')}
          disabled={busy || !!initial}
          onPress={() => setManual(true)}
        />
      )}
      {projects?.truncated && (
        <Text style={styles.muted}>
          <InterfaceText>
            {'More projects are available. Enter a project key manually if yours is missing.'}
          </InterfaceText>
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!connected && (
        <Text style={styles.muted}>
          <InterfaceText>{'Reconnect to this computer to change its issue source.'}</InterfaceText>
        </Text>
      )}
      <Action
        label={
          busy
            ? uiText('Checking connection…')
            : initial
              ? uiText('Save connection')
              : uiText('Add Jira source')
        }
        disabled={!connected || busy || !site.trim() || !project.trim()}
        onPress={() => void save()}
      />
      {initial && (
        <Action
          destructive
          label={uiText('Remove Jira source')}
          secondary
          disabled={!connected || busy}
          onPress={() => void save(true)}
        />
      )}
    </>
  )
}
