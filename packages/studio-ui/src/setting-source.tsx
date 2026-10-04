import { CornerDownRight, SlidersHorizontal, Undo2 } from 'lucide-react'
import { settingsScopeLabels, type SettingsScope } from '@dovo/protocol'
import { Button } from './components/ui/button'

export type SettingOrigin = {
  source: SettingsScope | 'built-in' | 'computer-default'
  overridden: boolean
}

export function SettingSource({
  origin,
  onReset,
  label,
  disabled = false,
}: {
  origin: SettingOrigin
  onReset?: () => void
  label: string
  disabled?: boolean
}) {
  const name =
    origin.source === 'built-in'
      ? 'Dovo default'
      : origin.source === 'computer-default'
        ? 'Computer preference'
        : settingsScopeLabels[origin.source]
  const Icon = origin.overridden ? SlidersHorizontal : CornerDownRight
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px]">
      <span
        className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${origin.overridden ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
      >
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        {origin.overridden ? `Set here · ${name}` : `Inherited · ${name}`}
      </span>
      {origin.overridden && onReset && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px] text-muted-foreground"
          disabled={disabled}
          aria-label={`Use inherited ${label.toLowerCase()}`}
          onClick={onReset}
        >
          <Undo2 className="size-3" />
          Reset
        </Button>
      )}
    </div>
  )
}
