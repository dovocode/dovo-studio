import type { Meta, StoryObj } from '@storybook/react-native'
import { SharingExample } from '../../src/catalog/sharing-example'
const meta = { title: 'Patterns/Encrypted sharing', component: SharingExample } satisfies Meta<
  typeof SharingExample
>
export default meta
export const Published: StoryObj<typeof meta> = {}

export const BeforePublishing: StoryObj<typeof meta> = { args: { published: false } }
export const Artifact: StoryObj<typeof meta> = { args: { kind: 'artifact' } }
export const Offline: StoryObj<typeof meta> = { args: { offline: true } }
