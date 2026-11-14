import { useInterfaceText } from '@dovo/studio-core/interface-language'
import type { ComponentProps, ReactNode } from 'react'
import { Globe2 } from 'lucide-react'
import { Button, ComposerSurface, ComposerSubmit, ComposerWorkspaceBar } from '@dovo/studio-ui'
import { StartupHeading } from '../task-creation/startup-heading'
import { BrowserAddressInput } from './browser-address-input'

export function BrowserStarter({
  address,
  controls,
  busy,
}: {
  address: ComponentProps<typeof BrowserAddressInput>
  controls: ReactNode
  busy: boolean
}) {
  const uiText = useInterfaceText()

  return (
    <div
      className="startup-draft flex h-full min-h-0 w-full flex-col overflow-y-auto"
      data-browser-starter
    >
      <StartupHeading
        heading="Where would you like to go?"
        description="Open a website, search the web, or preview a local app."
      />
      <div className="mb-auto w-full shrink-0 pb-8">
        <div className="task-composer">
          <ComposerSurface
            aria-label="New browser page"
            className="overflow-visible"
            controls={
              <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                <Globe2 className="size-3.5" />
                {uiText('Browser')}
              </span>
            }
            actions={
              <ComposerSubmit
                aria-label="Open browser"
                title="Open browser"
                busy={busy}
                disabled={busy || address.disabled || !address.value.trim()}
              />
            }
            onSubmit={(event) => {
              event.preventDefault()
              address.onNavigate(address.value, false)
            }}
          >
            <div data-composer-input className="relative flex min-h-20 px-3 py-4">
              <BrowserAddressInput {...address} suggestOnFocus={false} />
            </div>
          </ComposerSurface>
          <ComposerWorkspaceBar>{controls}</ComposerWorkspaceBar>
          <div
            className="mx-auto mt-4 flex max-w-[var(--chat-max)] flex-wrap justify-center gap-2"
            aria-label="Development servers"
          >
            {['localhost:3000', 'localhost:5173'].map((value) => (
              <Button
                key={value}
                variant="outline"
                size="sm"
                className="gap-2 text-xs font-normal"
                onClick={() => address.onNavigate(value, false)}
                disabled={busy || address.disabled}
              >
                <Globe2 className="size-3.5" />
                {value}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
