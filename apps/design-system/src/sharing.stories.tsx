import { ThreadSuggestions } from '../../../packages/extension-tasks/src/chat/thread-suggestions'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { SharingPanel } from '../../../packages/extension-tasks/src/chat/sharing-panel'
import { Button } from '@dovo/studio-ui'
import { createSharingFixture } from './sharing-fixture'
const meta = { title: 'Dovo/Patterns/Encrypted sharing', tags: ['autodocs'] } satisfies Meta
export default meta
function Preview({ published = true }: { published?: boolean }) {
  const [fixture] = useState(createSharingFixture),
    [ready, setReady] = useState(false),
    [draft, setDraft] = useState(''),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    void fixture.ready(published).then(() => setReady(true))
  }, [fixture, published])
  if (!ready) return <p role="status">Preparing synthetic sharing example…</p>
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-lg font-semibold">Share thread</h1>
      <p className="text-sm text-muted-foreground">
        Production sharing controls with encrypted synthetic data. All actions stay in memory.
      </p>
      <Button
        variant="outline"
        aria-pressed={failed}
        onClick={() => {
          fixture.fail(!failed)
          setFailed(!failed)
        }}
      >
        Simulate connection failure
      </Button>
      <SharingPanel
        client={fixture.client}
        sourceId={fixture.sourceId}
        kind="thread"
        runtime={fixture.runtime}
        onUseSuggestion={setDraft}
      />
      {draft && (
        <p role="status" className="rounded-xl border p-3">
          Composer draft: {draft}
        </p>
      )}
    </section>
  )
}
export const Published: StoryObj = {
  render: () => <Preview />,
  parameters: {
    docs: {
      description: {
        story:
          'The production manager owns invitations, expiring links, revocation, recovery and the private prompt inbox. This adapter makes no network requests.',
      },
    },
  },
}
export const BeforePublishing: StoryObj = { render: () => <Preview published={false} /> }

function InlinePreview() {
  const [fixture] = useState(createSharingFixture)
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState('Existing draft')
  useEffect(() => {
    void fixture.ready().then(() => setReady(true))
  }, [fixture])
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <p>The payment request is waiting for a response. I will trace its timeout.</p>
      {ready && (
        <ThreadSuggestions
          client={fixture.client}
          sourceId={fixture.sourceId}
          onUseSuggestion={(text) =>
            setDraft((previous) => [previous, text].filter(Boolean).join('\n\n'))
          }
        />
      )}
      <p role="status">Composer draft: {draft}</p>
    </div>
  )
}
export const InlineSuggestions: StoryObj = { render: () => <InlinePreview /> }
