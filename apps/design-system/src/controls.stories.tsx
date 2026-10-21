import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { Input } from '../../../packages/studio-ui/src/components/ui/input'
import { Textarea } from '../../../packages/studio-ui/src/components/ui/textarea'
import { PromptInput } from '../../../packages/studio-ui/src/components/ai-elements/prompt-input'

const meta = { title: 'Dovo/Controls', tags: ['autodocs'] } satisfies Meta
export default meta
export const Buttons: StoryObj = {
  render: () => (
    <section aria-label="Button variants" className="flex max-w-3xl flex-wrap items-center gap-4">
      {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map(
        (variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ),
      )}
      <Button disabled>Unavailable</Button>
      <Button aria-busy="true" disabled>
        Saving…
      </Button>
      <Button size="icon" aria-label="Add item">
        +
      </Button>
    </section>
  ),
}
export const Fields: StoryObj = {
  render: () => (
    <section className="grid max-w-md gap-4">
      <label htmlFor="name">Display name</label>
      <Input id="name" autoComplete="name" placeholder="Your name" />
      <label htmlFor="unavailable">Managed by organization</label>
      <Input id="unavailable" disabled value="Read only" />
      <label htmlFor="invalid">Server address</label>
      <Input
        id="invalid"
        aria-invalid="true"
        aria-describedby="address-error"
        defaultValue="invalid address"
      />
      <p id="address-error" className="text-destructive">
        Enter a valid server address.
      </p>
    </section>
  ),
}
function ComposerExample() {
  const [value, setValue] = useState('')
  const [sent, setSent] = useState(false)
  return (
    <section className="max-w-3xl">
      <h2 className="mb-4 text-xl">Compose a task</h2>
      <PromptInput
        className="studio-composer"
        onSubmit={(e) => {
          e.preventDefault()
          setSent(true)
        }}
      >
        <Textarea
          aria-label="Task message"
          className="min-h-32 resize-none rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setSent(false)
          }}
          placeholder="What would you like to build?"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
          <Button variant="ghost" type="button">
            Add context
          </Button>
          <Button type="submit" disabled={!value.trim()}>
            Send task
          </Button>
        </div>
      </PromptInput>
      {sent && (
        <p role="status" className="mt-3 text-muted-foreground">
          Preview submitted. No runtime request is made.
        </p>
      )}
    </section>
  )
}
export const Composer: StoryObj = { render: () => <ComposerExample /> }
export const States: StoryObj = {
  render: () => (
    <section className="grid max-w-2xl gap-4">
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-xl">No computers connected</h2>
        <p className="mt-2 text-muted-foreground">
          Pair a computer on your private network, or enable Dovo Connect.
        </p>
        <Button className="mt-4">Add computer</Button>
      </div>
      <div role="alert" className="rounded-xl border border-destructive p-6">
        <h2 className="text-xl">Connection interrupted</h2>
        <p className="mt-2 text-muted-foreground">
          Your changes are kept locally. Try connecting again.
        </p>
        <Button className="mt-4" variant="outline">
          Reconnect
        </Button>
      </div>
      <div role="status" aria-busy="true" className="rounded-xl border bg-card p-6">
        Connecting to your computer…
      </div>
    </section>
  ),
}
