import { Button, Image, Label } from '@expo/ui/swift-ui'
import { frame, resizable } from '@expo/ui/swift-ui/modifiers'
import type { ComponentProps } from 'react'
import type { IconName } from './icon'

export function NativeIcon({
  name,
  size = 20,
  modifiers = [],
  ...props
}: Omit<ComponentProps<typeof Image>, 'systemName' | 'assetName'> & { name: IconName }) {
  return (
    <Image
      {...props}
      assetName={`dovo-${name}`}
      modifiers={[resizable(), frame({ width: size, height: size }), ...modifiers]}
    />
  )
}

export function NativeIconLabel({ title, icon }: { title: string; icon: IconName }) {
  return <Label title={title} icon={<NativeIcon name={icon} />} />
}

/** A custom native Label also supplies the image to system context menus. */
export function NativeMenuButton({
  label,
  icon,
  ...props
}: Omit<ComponentProps<typeof Button>, 'label' | 'systemImage' | 'children'> & {
  label: string
  icon: IconName
}) {
  return (
    <Button {...props}>
      <NativeIconLabel title={label} icon={icon} />
    </Button>
  )
}
