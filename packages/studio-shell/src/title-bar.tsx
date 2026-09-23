import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect } from 'react'
import { Layers2, Monitor, Search } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@dovo/studio-ui'
export type DesktopPlatform = 'darwin' | 'win32' | 'linux'
export function TitleBar({
  platform,
  section,
  online,
  devices,
  onDevices,
  onSearch,
}: {
  platform?: DesktopPlatform
  section?: string
  online: number
  devices: number
  onDevices: () => void
  onSearch: () => void
}) {
  const [focused, setFocused] = useApplicationState(
    () => typeof document === 'undefined' || document.hasFocus(),
  )
  useEffect(() => {
    const focus = () => setFocused(true)
    const blur = () => setFocused(false)
    window.addEventListener('focus', focus)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return (
    <header
      className="studio-titlebar"
      data-platform={platform}
      data-window-focused={!platform || focused}
    >
      <div className="studio-titlebar-identity">
        <Layers2 size={15} strokeWidth={1.6} aria-hidden="true" />
        <span className="studio-titlebar-name">Dovo Studio</span>
        {section && <span className="studio-titlebar-section">{section}</span>}
      </div>
      <div className="studio-titlebar-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="studio-titlebar-button"
              onClick={onDevices}
              aria-label={`Manage devices · ${online} of ${devices} online`}
            >
              <Monitor size={14} aria-hidden="true" />
              <span className="studio-titlebar-device-count">
                {online}/{devices}
              </span>
              <span className="studio-titlebar-status" data-online={online > 0} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {online} of {devices} devices online
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="studio-titlebar-button"
              aria-label="Search commands"
              onClick={onSearch}
            >
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">Search commands</span>
              {platform && <kbd>{platform === 'darwin' ? '⌘ K' : 'Ctrl K'}</kbd>}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search commands</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}
