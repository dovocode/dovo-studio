import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import {
  jiraBindingSchema,
  jiraProjectsSchema,
  responses,
  jiraSourceSchema,
  type JiraSource,
} from '@dovo/protocol'
import { z } from 'zod'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'

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
  const { call, read, connected, profile } = useRuntime()
  const [name, setName] = useState(initial?.name ?? '')
  const [site, setSite] = useState(initial?.site ?? '')
  const [project, setProject] = useState(initial?.project ?? '')
  const [manual, setManual] = useState(false)
  const [projects, setProjects] = useState<z.infer<typeof jiraProjectsSchema>>()
  const [loading, setLoading] = useState(connected)
  const [revision, retry] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
    void read('/api/scm/jira/projects/read', {}, jiraProjectsSchema)
      .then((result) => {
        if (!current) return
        setProjects(result)
        if (!hasInitial) setSite(result.site)
      })
      .catch((cause) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [read, connected, revision, hasInitial])
  const save = async (remove = false) => {
    if (pending.current || !connected) return
    const parsed = jiraBindingSchema.safeParse({
      site: /^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${site.trim()}`,
      project: project.trim().toUpperCase(),
    })
    if (!remove && !parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a Jira site and project.')
      return
    }
    pending.current = true
    setBusy(true)
    onBusyChange(true)
    setError('')
    try {
      if (remove && initial)
        await call('/api/scm/jira/sources/remove', { sourceId: initial.id }, responses.ok)
      else
        await call(
          '/api/scm/jira/sources/save',
          {
            source: {
              ...parsed.data,
              ...(initial ? { id: initial.id } : {}),
              name: name.trim() || projects?.projects.find((entry) => entry.key === project)?.name,
            },
          },
          jiraSourceSchema,
        )
      onSaved?.()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
      onBusyChange(false)
    }
  }
  const projectItems =
    projects?.projects.map((entry) => ({ id: entry.key, name: `${entry.key} · ${entry.name}` })) ??
    []
  if (initial && !projectItems.some((entry) => entry.id === initial.project))
    projectItems.unshift({ id: initial.project, name: initial.project })
  return (
    <>
      <Text style={styles.muted}>
        Browse Jira independently of your code. Link an issue to a Dovo project when you are ready
        to work on it.
      </Text>
      <View style={{ gap: 4 }}>
        <Text style={styles.muted}>Signed-in account on {profile?.name ?? 'this computer'}</Text>
        <Text selectable style={styles.text}>
          {projects?.site ?? initial?.site ?? 'Checking Jira account…'}
        </Text>
      </View>
      {initial && (
        <Field
          label="Source name"
          value={name}
          onChangeText={setName}
          editable={!busy}
          placeholder={initial.project}
          maxLength={200}
        />
      )}
      {initial && projects && initial.site !== projects.site && (
        <Text style={styles.muted}>
          Current source: {initial.site} · {initial.project}. Sign in to this source’s account
          before editing it.
        </Text>
      )}
      {loading && <Text style={styles.muted}>Loading projects…</Text>}
      {!!loadError && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {loadError}
          </Text>
          <Text style={styles.muted}>
            On {profile?.name ?? 'this computer'}, sign in with acli jira auth login, then retry.
          </Text>
          <Action
            secondary
            label="Retry account"
            disabled={busy || loading || !connected}
            onPress={() => retry((value) => value + 1)}
          />
        </>
      )}
      {!manual && projectItems.length > 0 && (
        <Choice
          label="Jira space / project"
          value={project}
          disabled={busy || loading || !!initial}
          items={[{ id: '', name: 'Choose a project…' }, ...projectItems]}
          onChange={(value) => {
            setProject(value)
            if (projects) setSite(projects.site)
          }}
        />
      )}
      {!loading && !projects?.projects.length && !loadError && (
        <Text style={styles.muted}>
          No projects were returned by this account. Enter a project key below if you have access.
        </Text>
      )}
      {(manual || (!loading && !projectItems.length)) && (
        <>
          <Field
            label="Jira Cloud site"
            value={site}
            onChangeText={setSite}
            keyboardType="url"
            autoCorrect={false}
            editable={!busy && !initial}
            placeholder="team.atlassian.net"
          />
          <Field
            label="Project key"
            value={project}
            onChangeText={(value) => setProject(value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy && !initial}
            placeholder="TEAM"
          />
        </>
      )}
      {!initial && !manual && projectItems.length > 0 && (
        <Action
          secondary
          label="Enter project manually"
          disabled={busy || !!initial}
          onPress={() => setManual(true)}
        />
      )}
      {projects?.truncated && (
        <Text style={styles.muted}>
          More projects are available. Enter a project key manually if yours is missing.
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!connected && (
        <Text style={styles.muted}>Reconnect to this computer to change its issue source.</Text>
      )}
      <Action
        label={busy ? 'Checking connection…' : initial ? 'Save connection' : 'Add Jira source'}
        disabled={!connected || busy || !site.trim() || !project.trim()}
        onPress={() => void save()}
      />
      {initial && (
        <Action
          label="Remove Jira source"
          secondary
          disabled={!connected || busy}
          onPress={() => void save(true)}
        />
      )}
    </>
  )
}
