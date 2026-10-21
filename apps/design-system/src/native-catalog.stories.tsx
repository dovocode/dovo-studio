import type { Meta, StoryObj } from '@storybook/react-vite'

const meta = {
  title: 'Dovo/Mobile/Native simulator',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Actual iOS simulator captures from the on-device React Native Storybook on Mac Studio. These are reference captures, not interactive web approximations. Run the native catalog to inspect platform menus, gestures, keyboard behavior, and dialogs.',
      },
    },
  },
} satisfies Meta
export default meta

export const NativeReference: StoryObj<typeof meta> = {
  render: () => (
    <main className="mx-auto grid max-w-5xl gap-6 p-4">
      <div className="grid gap-2">
        <h1 className="text-xl font-semibold">Native component review</h1>
        <p className="text-sm text-muted-foreground">
          The web catalog renders React Native Web. The native catalog runs the production
          components on iOS, with local synthetic fixtures and no runtime connection.
        </p>
        <code className="break-words rounded-lg border bg-card p-3 text-sm">
          pnpm --filter @dovo/mobile storybook:ios --device &quot;Dovo UI Review&quot;
        </code>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <figure className="grid content-start gap-3">
          <img
            src="/native/ios-conversation.png"
            alt="iOS Storybook showing the production draft input, preserved failed-send draft, and selected review question"
            className="w-full rounded-xl border"
          />
          <figcaption className="text-sm text-muted-foreground">
            Conversation inputs: draft preservation and native question selection. This is the input
            layer; attachments and dictation belong to the full composer.
          </figcaption>
        </figure>
        <figure className="grid content-start gap-3">
          <img
            src="/native/ios-confirmation.png"
            alt="iOS settings confirmation showing explanatory text, a destructive action, close, and cancel"
            className="w-full rounded-xl border"
          />
          <figcaption className="text-sm text-muted-foreground">
            Settings: native layout, save-location menu, and confirmation. Captured on Mac Studio,
            iOS 27, 21 October 2026. Run locally for current behavior.
          </figcaption>
        </figure>
      </div>
    </main>
  ),
}
