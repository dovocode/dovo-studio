import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ApplicationStateProvider } from '@dovo/studio-core/state'
import {
  permissionPolicyLabel,
  permissionPolicySummary,
  selectPermissionPreset,
  type PermissionPolicy,
} from '../../../packages/protocol/src/auth/permission-policy'
import { selectableAccessModes } from '../../../packages/protocol/src/auth/access'
import type {
  PendingQuestion,
  QuestionAnswers,
} from '../../../packages/protocol/src/conversation/workflow/questions'
import { QuestionForm } from '../../../packages/studio-ui/src/question-form'
import {
  PermissionPolicyFields,
  permissionPolicyUIIssue,
} from '../../../packages/studio-ui/src/permission-policy-fields'
import { ChoicePicker } from '../../../packages/studio-ui/src/choice-picker'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'

const meta = { title: 'Dovo/Interactions', tags: ['autodocs'] } satisfies Meta
export default meta

const request: PendingQuestion = {
  id: 'preview-question-request',
  taskId: 'preview-task',
  createdAt: '2026-01-01T00:00:00.000Z',
  prompt: {
    title: 'Before I prepare this project change, choose the runtime and review scope.',
    blocking: true,
    questions: [
      {
        id: 'runtime',
        header: 'Where should the work run?',
        question:
          'Choose the computer that owns the project files. A paired computer must already be connected to this local preview session.',
        options: [
          {
            value: 'this-computer',
            label: 'This computer',
            description: 'Use the current workspace and its local files.',
          },
          {
            value: 'paired-computer',
            label: 'Paired computer',
            description:
              'Run on another paired machine. The actual task flow still verifies its runtime connection.',
          },
          {
            value: 'vpn-computer',
            label: 'Computer on my VPN',
            description:
              'Use a private VPN address such as a Tailscale or NetBird runtime address.',
          },
        ],
        multiple: false,
        custom: true,
        secret: false,
        required: true,
        inputType: 'text',
      },
      {
        id: 'review-scope',
        header: 'What should the review include?',
        question:
          'Select any review areas that should receive extra attention. You can also add another focus in your own words.',
        options: [
          {
            value: 'tests',
            label: 'Tests and verification',
            description:
              'Check existing tests and the most relevant targeted verification. Surface missing coverage and any environment-specific limits.',
          },
          {
            value: 'accessibility',
            label: 'Accessibility',
            description:
              'Review labels, keyboard use, focus behavior, and announcements in relevant flows.',
          },
          {
            value: 'small-diff',
            label: 'Keep the change focused',
            description:
              'Preserve unrelated work and avoid pulling in adjacent refactors unless they are required for a complete fix.',
          },
        ],
        multiple: true,
        custom: true,
        secret: false,
        required: true,
        inputType: 'text',
      },
      {
        id: 'ticket-number',
        header: 'Issue number',
        question:
          'Optional: enter the numeric issue to associate with this local preview. This value is displayed only in the answer summary below.',
        options: [],
        multiple: false,
        custom: true,
        secret: false,
        required: false,
        inputType: 'number',
      },
    ],
  },
}

export const QuestionChoicesAndValidation: StoryObj = {
  name: 'Question form · choices, free text, and validation',
  render: () => (
    <ApplicationStateProvider>
      <QuestionPreview />
    </ApplicationStateProvider>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'This uses the production QuestionForm and QuestionField with synthetic data. Try Send answers with required questions empty to see validation, select one runtime, choose multiple review areas, and enter custom text. Successful answers replace the form with a local summary and Reset. When connected, number keys 1–9 select the first question options only while focus is outside text fields, dialogs, and menus. No runtime request is made.',
      },
    },
  },
}

function QuestionPreview() {
  const [answers, setAnswers] = useState<QuestionAnswers | null>(null)
  const [declined, setDeclined] = useState(false)
  if (answers || declined) {
    return (
      <section className="grid max-w-2xl gap-4 rounded-xl border bg-card p-4">
        <div>
          <h2 className="font-semibold">{declined ? 'Question declined' : 'Answer received'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This is local preview state. No task or runtime was changed.
          </p>
        </div>
        {answers && (
          <dl className="grid gap-3 text-sm">
            {request.prompt.questions.map((question) => (
              <div key={question.id}>
                <dt className="font-medium">{question.header}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {(answers[question.id] ?? []).join(', ') || 'No answer'}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <Button
          variant="outline"
          onClick={() => {
            setAnswers(null)
            setDeclined(false)
          }}
        >
          Ask again
        </Button>
      </section>
    )
  }
  return (
    <div className="max-w-2xl">
      <QuestionForm
        request={request}
        connected
        onAnswer={async (next) => {
          if (next === null) setDeclined(true)
          else setAnswers(next)
        }}
      />
    </div>
  )
}

export const QuestionDisconnected: StoryObj = {
  name: 'Question form · disconnected state',
  render: () => (
    <ApplicationStateProvider>
      <div className="max-w-2xl">
        <QuestionForm
          request={request}
          connected={false}
          onAnswer={async () => {
            throw new Error('Disconnected preview must not submit answers.')
          }}
        />
      </div>
    </ApplicationStateProvider>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The production form disables choices and response actions while disconnected and explains that reconnection is required. This local story never invokes a runtime callback.',
      },
    },
  },
}

const initialPolicy: PermissionPolicy = {
  provider: 'codex',
  permission: 'workspace-write',
  approvalPolicy: 'on-request',
  sandboxMode: 'workspace-write',
}

export const PermissionPresetsAndDetails: StoryObj = {
  name: 'Permission policy · presets and advanced details',
  render: () => (
    <ApplicationStateProvider>
      <PermissionPolicyPreview />
    </ApplicationStateProvider>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Uses the production access preset list, preset reset helper, ChoicePicker, and PermissionPolicyFields. Select a preset to clear custom approval and sandbox overrides, then open Advanced to inspect supported controls or reset them to access mode. Edits stay in component state: this preview saves nothing, launches no agent, and grants no permission. Changing access in the product is followed by its explicit review/save and launch boundaries.',
      },
    },
  },
}

function PermissionPolicyPreview() {
  const [policy, setPolicy] = useState(initialPolicy)
  const modes = selectableAccessModes(policy.permission, policy.provider)
  const issue = permissionPolicyUIIssue(policy, true)
  return (
    <div className="grid max-w-xl gap-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">Synthetic Codex task policy</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This is a local policy editor preview, not an active grant.
        </p>
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-medium">Access preset</span>
        <ChoicePicker
          aria-label="Preview access preset"
          value={policy.permission}
          onValueChange={(value) => {
            const selected = modes.find((mode) => mode.id === value)
            if (selected) setPolicy((current) => selectPermissionPreset(current, selected.id))
          }}
        >
          {modes.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.name} · {mode.description}
            </option>
          ))}
        </ChoicePicker>
        <p className="text-xs text-muted-foreground">
          {modes.find((mode) => mode.id === policy.permission)?.description}
        </p>
      </div>
      <PermissionPolicyFields
        value={policy}
        supported
        inherited={{ approvalPolicy: 'on-request', sandboxMode: 'read-only' }}
        onChange={(next) => setPolicy((current) => ({ ...current, ...next }))}
      />
      <div className="rounded-md bg-muted/40 p-3 text-xs">
        <p className="font-medium">Effective preview · {permissionPolicyLabel(policy)}</p>
        <p className="mt-1 text-muted-foreground">{permissionPolicySummary(policy)}</p>
      </div>
      {issue && (
        <p role="alert" className="text-xs text-destructive">
          {issue}
        </p>
      )}
      <Button variant="outline" onClick={() => setPolicy(initialPolicy)}>
        Reset local preview
      </Button>
    </div>
  )
}

export const PermissionProviderBoundaries: StoryObj = {
  name: 'Permission policy · provider limits and confirmation boundary',
  render: () => (
    <ApplicationStateProvider>
      <PermissionBoundaryPreview />
    </ApplicationStateProvider>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'PermissionPolicyFields reflects provider capabilities, preserves unsupported saved values on older runtimes, and explains when a newer runtime is required. The controls below are disabled in this synthetic unsupported-runtime case. An approval prompt is a separate per-action decision; changing a policy here does not answer an approval or authorize a running task.',
      },
    },
  },
}

function PermissionBoundaryPreview() {
  const [policy, setPolicy] = useState<PermissionPolicy>({
    provider: 'codex',
    permission: 'ask',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
  })
  return (
    <div className="grid max-w-xl gap-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">Saved policy on an older runtime</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Existing restrictions remain visible while separate controls are unavailable.
        </p>
      </div>
      <PermissionPolicyFields
        value={policy}
        supported={false}
        disabled
        onChange={(next) => setPolicy((current) => ({ ...current, ...next }))}
      />
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
        Saving or granting access requires the real task settings flow and an explicit user action.
        This preview performs neither action.
      </p>
      <Button variant="outline" onClick={() => setPolicy(initialPolicy)}>
        Reset local example
      </Button>
    </div>
  )
}
