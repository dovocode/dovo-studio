import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ComposerField } from '../../mobile/src/tasks/composer/composer-field'
import { QuestionField } from '../../mobile/src/tasks/composer/question-field'
import { Action } from '../../mobile/src/ui/controls/action'
import { decode, agentQuestionSchema, type QuestionDraft } from '../../../packages/protocol/src'
import { MobilePreview } from './mobile-preview'

const meta = {
  title: 'Dovo/Mobile/Conversation controls',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Actual mobile ComposerField and QuestionField rendered through React Native Web. Local composition demonstrates draft retention, failure, explicit replacement, single/multiple choices and custom answers. This is the production input layer, not the full native composer: attachments, dictation, keyboard/selection behavior, runtime sends and native menus require on-device review.',
      },
    },
  },
} satisfies Meta
export default meta

function DraftExample({ disconnected = false }: { disconnected?: boolean }) {
  const [draft, setDraft] = useState('')
  const [revision, setRevision] = useState(0)
  const [fail, setFail] = useState(true)
  const [message, setMessage] = useState('Draft stays local to this preview.')
  const [lastSent, setLastSent] = useState('')
  const replace = (text: string) => {
    setDraft(text)
    setRevision((value) => value + 1)
  }
  return (
    <section className="min-w-0 space-y-4" aria-label="Mobile composer input example">
      <h2 className="text-lg font-semibold">Draft, failure and recovery</h2>
      <p className="text-sm text-muted-foreground">
        Production multiline input; local simulated send. A failed send keeps your draft.
      </p>
      <div className="min-w-0 rounded-xl border bg-card">
        <ComposerField
          showOptions
          trailingControlCount={1}
          revision={String(revision)}
          value={draft}
          onChangeText={setDraft}
          onSelectionChange={() => undefined}
          placeholder="Write a follow-up…"
        />
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={fail} onChange={(event) => setFail(event.target.checked)} />
        Simulate failed send
      </label>
      <div className="flex flex-wrap gap-3">
        <Action
          label="Send preview"
          wide
          disabled={disconnected || !draft.trim()}
          onPress={() => {
            if (fail) {
              setMessage(
                'Simulated send failed. Your draft is preserved; turn off failure to retry.',
              )
              return
            }
            setLastSent(draft)
            replace('')
            setMessage('Sent to this preview only.')
          }}
        />
        <Action
          label="Restore example draft"
          secondary
          onPress={() =>
            replace('Review the navigation changes, then explain the accessibility fixes.')
          }
        />
        <Action label="Clear draft" secondary onPress={() => replace('')} />
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {disconnected ? 'Disconnected: draft remains editable; sending is unavailable.' : message}
      </p>
      {lastSent && (
        <div className="rounded-xl border p-3">
          <h3 className="text-sm font-medium">Local sent message</h3>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{lastSent}</p>
        </div>
      )}
    </section>
  )
}
export const DraftAndRecovery: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <DraftExample />
    </MobilePreview>
  ),
}
export const DisconnectedDraft: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <DraftExample disconnected />
    </MobilePreview>
  ),
}

const question = decode(agentQuestionSchema, {
  id: 'catalog-choice',
  header: 'Review scope',
  question: 'Which parts should the next review cover?',
  multiple: true,
  custom: true,
  options: [
    {
      value: 'layout',
      label: 'Layout and navigation',
      description: 'Check small screens and long labels.',
    },
    {
      value: 'accessibility',
      label: 'Accessibility',
      description: 'Check focus, contrast and touch targets.',
    },
  ],
})
function QuestionExample({
  multiple = true,
  disabled = false,
}: {
  multiple?: boolean
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<QuestionDraft>({ selected: [], text: '' })
  return (
    <section className="space-y-4" aria-label="Mobile question example">
      <h2 className="text-lg font-semibold">Question choices and custom answer</h2>
      <QuestionField
        question={{ ...question, multiple }}
        draft={draft}
        onChange={setDraft}
        disabled={disabled}
      />
      <p role="status" className="break-words text-sm text-muted-foreground">
        Local answer:{' '}
        {[...draft.selected, draft.text].filter(Boolean).join(', ') || 'Nothing selected'}
      </p>
      <p className="text-xs text-muted-foreground">
        No answer is submitted to an agent. Single-choice custom text replaces the selected option;
        multiple-choice custom text supplements it.
      </p>
    </section>
  )
}
export const MultipleChoice: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <QuestionExample />
    </MobilePreview>
  ),
}
export const SingleChoice: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <QuestionExample multiple={false} />
    </MobilePreview>
  ),
}
export const DisabledQuestion: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <QuestionExample disabled />
    </MobilePreview>
  ),
}
