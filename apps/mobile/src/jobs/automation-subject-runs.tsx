import { useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import type { AutomationRunSubject } from '@dovo/protocol'
import { useAutomationSubjectRuns } from '@dovo/studio-core/automation-subject-runs'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import { automationHref } from '../shell/source-route'

export function AutomationSubjectRuns({ subject }: { subject: AutomationRunSubject }) {
  const uiText = useInterfaceText()
  const [open, setOpen] = useState(false)
  const { activeId, call, connected, connection, snapshot } = useRuntime()
  const supported = snapshot?.automationRunSubjectSupported === true
  const { runs, error, loading } = useAutomationSubjectRuns({
    subject: open && supported ? subject : undefined,
    connection,
    connected,
    request: call,
  })
  if (!supported || !activeId) return null
  return (
    <View style={{ gap: 6 }}>
      <Action
        secondary
        label={open ? uiText('Hide automation runs') : uiText('Automation runs')}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          {loading && (
            <Text accessibilityRole="progressbar">{uiText('Loading automation runs…')}</Text>
          )}
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
          {!connected && !runs && <Text>{uiText('Reconnect to find automation runs.')}</Text>}
          {runs?.length === 0 && <Text>{uiText('No automation runs found.')}</Text>}
          {runs?.map((run) => (
            <Action
              key={run.id}
              secondary
              label={`${snapshot.workspace.automations.find((flow) => flow.id === run.automationId)?.name ?? run.automationId} · ${run.status}`}
              onPress={() => router.push(automationHref(activeId, run.automationId, run.id))}
            />
          ))}
        </>
      )}
    </View>
  )
}
