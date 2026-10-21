import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'Dovo/Mobile/Pull request reviews',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Pull request status uses the native Markdown renderer and runtime context, so review it in the React Native Storybook. The web catalog links to the native simulator reference for platform captures.',
      },
    },
  },
} satisfies Meta
export default meta

export const NativeOnly: StoryObj<typeof meta> = {
  render: () => (
    <main className="mx-auto grid max-w-2xl gap-4 p-6">
      <h1 className="text-xl font-semibold">Pull request reviews are native-only</h1>
      <p className="text-sm text-muted-foreground">
        The production pull status includes native Markdown and runtime integrations that this web
        catalog cannot represent faithfully. Open the native story{' '}
        <strong>“Dovo/Mobile/Pull request reviews”</strong> to inspect open, draft, and merged
        fixtures with interactive check and review details.
      </p>
      <p className="text-sm text-muted-foreground">
        The{' '}
        <a
          className="underline"
          href="/?path=/story/dovo-mobile-native-simulator--native-reference"
          target="_top"
        >
          Native simulator reference
        </a>{' '}
        collects platform captures and instructions for running the iOS catalog.
      </p>
    </main>
  ),
}
