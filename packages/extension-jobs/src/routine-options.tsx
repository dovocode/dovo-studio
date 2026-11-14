import { useState } from 'react'
import {
  routineOptionFields,
  routineOptionLabels,
  parseRoutineOptions,
  type Automation,
} from '@dovo/protocol'
import { Button, FormField, Input } from '@dovo/studio-ui'
export function RoutineOptions({
  flow,
  disabled,
  jsonMonitoringSupported = false,
  mcpMonitoringSupported = false,
  findingGroupsSupported = false,
  onSave,
}: {
  flow: Automation
  disabled: boolean
  jsonMonitoringSupported?: boolean
  mcpMonitoringSupported?: boolean
  findingGroupsSupported?: boolean
  onSave: (options: Pick<Automation, 'policy' | 'monitor'>) => void
}) {
  const [fields, setFields] = useState(() => routineOptionFields(flow))
  const [error, setError] = useState('')
  return (
    <details className="border-b px-4 py-3 text-xs">
      <summary>Monitoring and limits</summary>
      <p className="my-2 text-muted-foreground">
        A source check uses a bounded HTTP GET. Automatic runs skip the agent when content is
        unchanged. An optional JSON pointer watches only that value and ignores object key order.
        Manual tests always run. Quiet hours defer successful Bot reports. Failures and approvals
        stay visible. Usage limits depend on provider reports and can overrun.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(routineOptionLabels) as Array<keyof typeof routineOptionLabels>)
          .filter((key) => key !== 'jsonPointer' || jsonMonitoringSupported)
          .filter((key) => key !== 'matter' || findingGroupsSupported)
          .filter((key) => !['mcpServer', 'mcpUri'].includes(key) || mcpMonitoringSupported)
          .map((key) => (
            <FormField key={key} label={routineOptionLabels[key]}>
              <Input
                aria-label={routineOptionLabels[key]}
                value={fields[key]}
                disabled={disabled}
                placeholder={key === 'start' || key === 'end' ? 'HH:mm' : undefined}
                onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
              />
            </FormField>
          ))}
      </div>
      <Button
        size="sm"
        className="mt-2"
        disabled={disabled}
        onClick={() => {
          try {
            if (fields.jsonPointer && !jsonMonitoringSupported)
              throw Error('Update this runtime to edit JSON monitoring.')
            if ((fields.mcpServer || fields.mcpUri) && !mcpMonitoringSupported)
              throw Error('Update this runtime to edit MCP monitoring.')
            onSave(parseRoutineOptions(fields))
            setError('')
          } catch {
            setError(
              'Check the limits, source URL, and quiet hours. Limits must be positive. Use HH:mm and a valid time zone.',
            )
          }
        }}
      >
        Save monitoring and limits
      </Button>
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
