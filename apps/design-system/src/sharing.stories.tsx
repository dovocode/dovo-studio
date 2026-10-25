import { ThreadSuggestions } from '../../../packages/extension-tasks/src/chat/thread-suggestions'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { SharingPanel } from '../../../packages/extension-tasks/src/chat/sharing-panel'
import { Button } from '@dovo/studio-ui'
import { createSharingFixture } from './sharing-fixture'
const meta = { title: 'Dovo/Patterns/Encrypted sharing', tags: ['autodocs'] } satisfies Meta
export default meta
function Preview({
  published = true,
  kind = 'thread',
  offline = false,
}: {
  published?: boolean
  kind?: 'thread' | 'artifact'
  offline?: boolean
}) {
  const [fixture] = useState(() => createSharingFixture({ kind, withKey: published })),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false)
  useEffect(() => {
    void fixture.ready(published).then(() => setReady(true))
  }, [fixture, published])
  if (!ready) return <p role="status">Preparing synthetic sharing example…</p>
  return (
    <section className="mx-auto max-w-xl space-y-4">
      <h1 className="text-lg font-semibold">Share {kind}</h1>
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
        kind={kind}
        content={kind === 'artifact' ? fixture.content : undefined}
        runtime={offline ? undefined : fixture.runtime}
      />
    </section>
  )
}
export const Published: StoryObj = {
  render: () => <Preview />,
  parameters: {
    docs: {
      description: {
        story:
          'Compact sharing with people, general access and a reusable link. Advanced holds expiry, updates, recovery and deletion. This adapter makes no network requests.',
      },
    },
  },
}
export const BeforePublishing: StoryObj = { render: () => <Preview published={false} /> }
export const Artifact: StoryObj = { render: () => <Preview kind="artifact" /> }
export const Offline: StoryObj = { render: () => <Preview offline /> }

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
