import type { Meta, StoryObj } from '@storybook/react-native'
import { MathExample } from '../../src/catalog/math-example'

const meta = { title: 'Dovo/Mobile/Math', component: MathExample } satisfies Meta<
  typeof MathExample
>
export default meta
export const Equations: StoryObj<typeof meta> = {}
