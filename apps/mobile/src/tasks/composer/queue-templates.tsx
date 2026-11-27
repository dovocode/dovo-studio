import { useState, type ReactNode } from 'react'
import { queueTemplateSource, type Task } from '@dovo/protocol'
import { useQueueTemplates } from '@dovo/studio-core/queue-templates'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { TextInput, View } from 'react-native'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import type { MenuAction } from '../../ui/controls/action-menu'
import { Choice } from '../../ui/controls/choice'
import { Text } from '../../ui/content/text'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'

export function QueueTemplates({
  task,
  children,
}: {
  task: Task
  children: (action?: MenuAction) => ReactNode
}) {
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const { snapshot, connected, read, call } = useRuntime()
  const templates = useQueueTemplates(task.id, task.repositoryId, read, call)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState('')
  const available =
    snapshot?.queueTemplatesSupported &&
    !task.archived &&
    !task.archivedAt &&
    !task.machineHandoff &&
    snapshot.workspace.repositories.some((project) => project.id === task.repositoryId)
  const source = templates.open
    ? queueTemplateSource(
        snapshot?.workspace.tasks.find((item) => item.id === task.id)?.queue ?? [],
      )
    : undefined
  const disabled = templates.busy || !connected
  const confirmDelete = deleting === templates.selected?.id
  return (
    <>
      {children(
        available
          ? {
              title: uiText('Queue templates'),
              label: uiText('Queue templates'),
              icon: 'checklist',
              disabled: !connected,
              onPress: templates.show,
            }
          : undefined,
      )}
      {available && templates.open && (
        <Sheet title={uiText('Queue templates')} onClose={templates.close}>
          <View style={{ gap: 10 }}>
            <Text style={styles.muted}>
              {uiText('Add editable messages in order. The queue stays paused until you run it.')}
            </Text>
            {templates.error && (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {templates.error}
              </Text>
            )}
            {templates.busy && <Text accessibilityLiveRegion="polite">{uiText('Working…')}</Text>}
            {templates.templates === undefined && templates.error && (
              <Action
                secondary
                label={uiText('Retry')}
                disabled={disabled}
                onPress={() => void templates.refresh()}
              />
            )}
            {templates.templates?.length === 0 && (
              <Text>{uiText('No queue templates for this project.')}</Text>
            )}
            {!!templates.templates?.length && (
              <Choice
                label={uiText('Template')}
                items={templates.templates.map(({ id, name }) => ({ id, name }))}
                value={templates.selected?.id ?? ''}
                disabled={disabled}
                onChange={(id) => {
                  setDeleting('')
                  templates.select(id)
                }}
              />
            )}
            {templates.selected && (
              <>
                {templates.selected.steps.map((step, index) => (
                  <Text key={index}>
                    {index + 1}. {step}
                  </Text>
                ))}
                <Action
                  label={uiText('Add template to queue')}
                  disabled={disabled}
                  onPress={() => void templates.stage()}
                />
                <Action
                  secondary
                  label={uiText(confirmDelete ? 'Confirm delete' : 'Delete template')}
                  disabled={disabled}
                  onPress={() => {
                    if (confirmDelete) void templates.remove()
                    else if (templates.selected) setDeleting(templates.selected.id)
                  }}
                />
                {confirmDelete && (
                  <Action secondary label={uiText('Cancel')} onPress={() => setDeleting('')} />
                )}
              </>
            )}
            <Text>{uiText('Template name')}</Text>
            <TextInput
              accessibilityLabel={uiText('Template name')}
              value={name}
              onChangeText={setName}
              maxLength={80}
              editable={!!source && !disabled}
              style={{
                color: colors.text,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 8,
                padding: 10,
              }}
            />
            {!source && (
              <Text style={styles.muted}>
                {uiText('Queue plain-text messages to save a template.')}
              </Text>
            )}
            <Action
              secondary
              label={uiText('Save queue as template')}
              disabled={!name.trim() || !source || disabled}
              onPress={() => {
                if (source) void templates.save(name, source.fingerprint)
              }}
            />
          </View>
        </Sheet>
      )}
    </>
  )
}
