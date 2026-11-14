import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Choice } from '../../ui/controls/choice'
import type { IconName } from '../../ui/controls/icon'

export type BrowserMenuProps = {
  items: { id: string; name: string; icon?: IconName; disabled?: boolean }[]
  onChange: (value: string) => void
}

export function BrowserMenu({ items, onChange }: BrowserMenuProps) {
  const uiText = useInterfaceText()

  return (
    <Choice
      label={uiText('Browser options')}
      hideLabel
      compact
      value=""
      selectedLabel="•••"
      items={items}
      onChange={onChange}
    />
  )
}
