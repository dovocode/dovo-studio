import { type useStudioSourcePolicy } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button } from '@dovo/studio-ui'

export function ExtensionSourceAccess({
  policy,
  title,
  app = false,
}: {
  policy: ReturnType<typeof useStudioSourcePolicy>
  title: string
  app?: boolean
}) {
  const uiText = useInterfaceText()
  const current = policy.policy
  const allow = (access: 'session' | 'persistent') => {
    if (
      window.confirm(
        `${uiText(app ? 'Allow this MCP App to use its server tools? These tools can make changes.' : 'Allow this extension to use the selected MCP tool?')}\n\n${title}`,
      )
    )
      void policy.save({ access, autoLoad: current?.autoLoad ?? false })
  }
  return (
    <div className="space-y-1">
      {current && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={policy.saving || current.access === 'session'}
            onClick={() => allow('session')}
          >
            {uiText('Allow for session')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={policy.saving || current.access === 'persistent'}
            onClick={() => allow('persistent')}
          >
            {uiText('Always allow')}
          </Button>
          {current.access !== 'off' && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={policy.saving}
                onClick={() => void policy.save({ access: 'off', autoLoad: false })}
              >
                {uiText('Revoke access')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={policy.saving}
                aria-pressed={current.autoLoad}
                onClick={() => void policy.save({ ...current, autoLoad: !current.autoLoad })}
              >
                {uiText(current.autoLoad ? 'Disable load on open' : 'Load on open')}
              </Button>
            </>
          )}
        </div>
      )}
      {policy.error && (
        <p role="alert" className="text-destructive">
          {policy.error}
        </p>
      )}
    </div>
  )
}
