import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { FormField } from '../../../packages/studio-ui/src/components/form-field'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { Checkbox } from '../../../packages/studio-ui/src/components/ui/checkbox'
import { Input } from '../../../packages/studio-ui/src/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../packages/studio-ui/src/components/ui/dialog'
import {
  Segmented,
  SettingRow,
  SettingsGroup,
  SettingsPage,
  Toggle,
} from '../../../packages/studio-ui/src/settings-layout'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../packages/studio-ui/src/components/ui/select'

const meta = {
  title: 'Dovo/Patterns/Forms and settings',
  tags: ['autodocs'],
} satisfies Meta
export default meta

const story = (description: string) => ({
  docs: { description: { story: description } },
})

function FormAnatomyExample() {
  const [name, setName] = useState('Dominic')
  const [environment, setEnvironment] = useState('Development')
  const [saved, setSaved] = useState(false)
  return (
    <form
      className="grid max-w-xl gap-5 rounded-xl border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(true)
      }}
    >
      <div>
        <h2 className="text-base font-semibold">Workspace details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A label, one sentence of context, then the control.
        </p>
      </div>
      <FormField label="Workspace name">
        <Input value={name} onChange={(event) => setName(event.target.value)} />
        <span className="text-xs font-normal text-muted-foreground">
          Visible to everyone using this workspace.
        </span>
      </FormField>
      <FormField label="Environment">
        <Select value={environment} onValueChange={setEnvironment}>
          <SelectTrigger aria-label="Environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Development">Development</SelectItem>
            <SelectItem value="Staging">Staging</SelectItem>
            <SelectItem value="Production">Production</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {saved ? 'Saved in this preview.' : 'Changes stay in this preview.'}
        </span>
        <Button type="submit">Save workspace</Button>
      </div>
    </form>
  )
}

export const FieldAnatomy: StoryObj = {
  render: () => <FormAnatomyExample />,
  parameters: story(
    'Shows the FormField label/control relationship, concise supporting text, a real select, and a submit action that changes local preview state only. On narrow screens the fields stack naturally.',
  ),
}

function ValidationExample() {
  const [address, setAddress] = useState('http://')
  const [submitted, setSubmitted] = useState(false)
  const invalid = submitted && !/^https?:\/\/[^\s/]+/i.test(address)
  return (
    <form
      className="grid max-w-lg gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        setSubmitted(true)
      }}
    >
      <FormField
        label="Runtime address"
        error={
          invalid
            ? 'Enter a host after http:// or https://, for example http://studio.lan:4000.'
            : undefined
        }
      >
        <Input
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'runtime-address-help' : undefined}
          value={address}
          onChange={(event) => {
            setAddress(event.target.value)
            setSubmitted(false)
          }}
        />
      </FormField>
      <p id="runtime-address-help" className="text-xs text-muted-foreground">
        HTTP remains valid for LAN and VPN runtimes. HTTPS is optional.
      </p>
      <div className="flex gap-2">
        <Button type="submit">Check address</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setAddress('http://studio.lan:4000')
            setSubmitted(false)
          }}
        >
          Use example
        </Button>
      </div>
    </form>
  )
}
export const ValidationAndHelperText: StoryObj = {
  render: () => <ValidationExample />,
  parameters: story(
    'Submit to see an inline error associated with the field; edit or choose the valid example to clear it. Errors use a specific correction and keep HTTP LAN/VPN addresses valid.',
  ),
}

function SettingsRowsExample() {
  const [notifications, setNotifications] = useState(true)
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [scope, setScope] = useState('project')
  const reset = () => {
    setNotifications(true)
    setDensity('comfortable')
    setScope('project')
  }
  return (
    <div className="max-w-3xl">
      <SettingsPage title="Notifications" description="Choose which updates appear in Dovo." local>
        <SettingsGroup
          title="Task updates"
          description="Keep high-signal events close without crowding the list."
        >
          <SettingRow
            label="Completion notices"
            description="Show a notice when a task finishes or needs attention."
          >
            <Toggle
              label="Completion notices"
              checked={notifications}
              onChange={setNotifications}
            />
          </SettingRow>
          <SettingRow label="Task list density" description="Compact rows fit more work on screen.">
            <Segmented
              label="Task list density"
              value={density}
              options={
                [
                  ['comfortable', 'Comfortable'],
                  ['compact', 'Compact'],
                ] as const
              }
              onChange={setDensity}
            />
          </SettingRow>
          <SettingRow
            label="Default scope"
            description="The project selected when opening task settings."
            source={<span className="text-xs text-muted-foreground">Set by this project</span>}
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Default scope">
              {['project', 'computer', 'account'].map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={scope === value ? 'secondary' : 'outline'}
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                >
                  {value}
                </Button>
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>
        <div className="flex justify-end">
          <Button variant="outline" onClick={reset}>
            Reset preview
          </Button>
        </div>
      </SettingsPage>
    </div>
  )
}
export const ResponsiveSettingsRows: StoryObj = {
  render: () => <SettingsRowsExample />,
  parameters: story(
    'Uses SettingsPage, SettingsGroup, and SettingRow with working switch, segmented radio group, and scope choice. Wide layouts put controls beside their descriptions; narrow layouts stack them. Reset restores the example values.',
  ),
}

function DestructiveConfirmationExample() {
  const [open, setOpen] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const reset = () => {
    setOpen(false)
    setDeleted(false)
  }
  return (
    <div className="max-w-xl rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-semibold">{deleted ? 'Project removed' : 'Project settings'}</h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">
            {deleted ? 'Files remain on disk.' : 'dovo-studio · ~/work/dovo-studio'}
          </p>
        </div>
        {!deleted ? (
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete project
          </Button>
        ) : (
          <Button variant="outline" onClick={reset}>
            Reset preview
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “dovo-studio”?</DialogTitle>
            <DialogDescription>
              Project settings and Dovo task history will be removed. Repository files stay on disk.
              This preview does not call a runtime.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep project
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false)
                setDeleted(true)
              }}
            >
              Delete project and history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
export const DestructiveConfirmation: StoryObj = {
  render: () => <DestructiveConfirmationExample />,
  parameters: story(
    'The destructive action opens a keyboard-accessible dialog with clear consequences, a safe cancel action, and an explicit final action. Confirming changes only this local story; Reset preview restores it.',
  ),
}

function PermissionChoicesExample() {
  const [network, setNetwork] = useState(false)
  const [commands, setCommands] = useState(true)
  return (
    <section className="max-w-2xl rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-4 flex gap-3">
        <span aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground">
          Access
        </span>
        <div>
          <h2 className="text-sm font-semibold">Project permissions</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Each permission is explicit and scoped to this project. Changes below are local preview
            state.
          </p>
        </div>
      </div>
      <div className="grid gap-4">
        <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm">
          <Checkbox
            checked={commands}
            onCheckedChange={(checked) => setCommands(checked === true)}
          />
          <span>
            <span className="block font-medium">Run approved commands</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Allow only commands listed in this project’s approved command set.
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3 rounded-md border p-3 text-sm">
          <Checkbox checked={network} onCheckedChange={(checked) => setNetwork(checked === true)} />
          <span>
            <span className="block font-medium">Use web browsing</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Allow requests approved by the project owner. Pairing and device tokens remain
              required.
            </span>
          </span>
        </label>
      </div>
      <p role="status" className="mt-3 text-xs text-muted-foreground">
        {commands || network
          ? 'Selected permissions are shown above.'
          : 'No optional permissions selected.'}
      </p>
    </section>
  )
}
export const PermissionChoices: StoryObj = {
  render: () => <PermissionChoicesExample />,
  parameters: story(
    'Demonstrates explicit permission choices with full-row labels, explanatory scope, and a live status. On touch layouts each choice has a generous target and remains operable by keyboard.',
  ),
}

function LongSettingsContentExample() {
  const [details, setDetails] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <form
      className="max-w-3xl"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(true)
      }}
    >
      <SettingsGroup
        title="Task instructions"
        description="Instructions are included with each task created in this project. Keep them relevant and easy to scan."
      >
        <SettingRow
          label="Additional instructions"
          description="Long content wraps and grows the row instead of colliding with its control."
        >
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Additional instructions"
            placeholder="Use the existing package manager. Keep changes focused…"
            value={details}
            onChange={(event) => {
              setDetails(event.target.value)
              setSaved(false)
            }}
          />
        </SettingRow>
      </SettingsGroup>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span aria-live="polite" className="break-words text-xs text-muted-foreground">
          {saved ? 'Preview saved locally.' : `${details.length} characters`}
        </span>
        <Button type="submit">Save instructions</Button>
      </div>
    </form>
  )
}
export const LongSettingsContent: StoryObj = {
  render: () => <LongSettingsContentExample />,
  parameters: story(
    'Long descriptions and textarea content remain readable and wrap without forcing the control outside the row. The save action updates a local status; no settings endpoint is involved.',
  ),
}
