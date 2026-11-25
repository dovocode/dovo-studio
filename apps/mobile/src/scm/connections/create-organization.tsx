import {
  organizationChangeResultSchema,
  organizationKey,
  projectDisplayName,
  projectOrganizationAssignment,
  projectOrganizationId,
  studioOrganizations,
} from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { View } from 'react-native'
import { useRuntime } from '../../runtime/connection/provider'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { useAction } from '../../ui/controls/use-action'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'

export function CreateOrganization({
  onClose,
  repositoryId,
}: {
  onClose: () => void
  repositoryId?: string
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { snapshot, connected, call, refresh } = useRuntime()
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState(repositoryId)
  const { act, busy, error } = useAction()
  const repositories = snapshot?.workspace.repositories ?? []
  const projects = repositories.filter(
    (repo) =>
      repo.kind !== 'scratch' && !repo.archived && !projectOrganizationId(repo, snapshot?.defaults),
  )
  const project = projects.find(
    (repo) => repo.id === (projectId ?? (projects.length === 1 ? projects[0]?.id : undefined)),
  )
  const duplicate =
    !!name.trim() &&
    [...studioOrganizations(snapshot?.defaults, repositories).values()].some(
      (entry) => organizationKey(entry.name) === organizationKey(name),
    )
  return (
    <Sheet title={uiText('New organization')} busy={busy} onClose={onClose}>
      <View style={{ gap: 12 }}>
        <Text style={styles.muted}>
          {uiText('Group projects that share skills, MCP servers, and AGENTS.md instructions.')}
        </Text>
        {snapshot && !snapshot.sharedOrganizationsSupported && (
          <Text style={styles.muted}>{uiText('Saved on this computer.')}</Text>
        )}
        {projects.length ? (
          <>
            <Field
              label={uiText('Organization name')}
              value={name}
              onChangeText={setName}
              maxLength={80}
              editable={!busy}
            />
            <Choice
              label={uiText('First project')}
              value={project?.id ?? ''}
              selectedLabel={project ? undefined : uiText('Choose a project')}
              disabled={busy}
              items={projects.map((repo) => ({ id: repo.id, name: projectDisplayName(repo) }))}
              onChange={setProjectId}
            />
            {duplicate && (
              <Text accessibilityRole="alert" style={styles.error}>
                {uiText('An organization already uses this name.')}
              </Text>
            )}
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            <Action
              label={uiText('Create and link organization')}
              disabled={!connected || !project || !name.trim() || duplicate || busy}
              onPress={() =>
                act(async () => {
                  if (!connected || !project || !name.trim() || duplicate) return
                  await call(
                    '/api/agents/settings/organization',
                    projectOrganizationAssignment(
                      project,
                      name,
                      [],
                      snapshot?.sharedOrganizationsSupported,
                    ),
                    organizationChangeResultSchema,
                  )
                  await refresh().catch(() => {})
                  onClose()
                })
              }
            />
          </>
        ) : (
          <Text style={styles.muted}>
            {uiText('Add an ungrouped project or folder on this computer first.')}
          </Text>
        )}
      </View>
    </Sheet>
  )
}
