import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps, type ReactElement } from 'react'
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { Badge } from '../../../packages/studio-ui/src/components/ui/badge'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'
import { Checkbox } from '../../../packages/studio-ui/src/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../packages/studio-ui/src/components/ui/dialog'
import { Input } from '../../../packages/studio-ui/src/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '../../../packages/studio-ui/src/components/ui/select'
import { Switch } from '../../../packages/studio-ui/src/components/ui/switch'
import { Textarea } from '../../../packages/studio-ui/src/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../packages/studio-ui/src/components/ui/tooltip'

const meta = { title: 'Dovo/Primitives', tags: ['autodocs'] } satisfies Meta
export default meta

const note = (description: string, render: () => ReactElement): StoryObj => ({
  render,
  parameters: { docs: { description: { story: description } } },
})

const fieldClass = 'grid gap-1.5'
const labelClass = 'text-sm font-medium leading-none'
const helpClass = 'text-xs text-muted-foreground'

export const ButtonAnatomy = note(
  'Use a visible label for actions. Leading and trailing icons are decorative when the label already names the action. Web buttons use native Enter and Space activation; React Native surfaces use platform button roles and accessibility labels.',
  () => (
    <div className="grid max-w-xl gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button>
          <Sparkles aria-hidden="true" />
          Ask Dovo
        </Button>
        <Button variant="outline">
          Copy link
          <Copy aria-hidden="true" />
        </Button>
        <Button variant="secondary">
          <Settings2 aria-hidden="true" />
          Settings
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm">
          <ChevronRight aria-hidden="true" />
          View details
        </Button>
        <Button variant="link">Read the guide</Button>
        <Button variant="destructive">Remove device</Button>
      </div>
    </div>
  ),
)

export const ButtonSizesAndIconNames = note(
  'The component exposes default, sm, lg, and icon sizes. An icon-only button needs an accessible name because its graphic has no spoken label. Keep the icon button target large enough for the surface where it appears.',
  () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm">Small</Button>
      <Button>Default</Button>
      <Button size="lg">Large action</Button>
      <Button size="touch">Touch action</Button>
      <Button size="icon" variant="outline" aria-label="Add project">
        <Plus aria-hidden="true" />
      </Button>
      <Button size="icon" variant="ghost" aria-label="Close panel">
        <X aria-hidden="true" />
      </Button>
    </div>
  ),
)

export const ButtonBusyDisabled = note(
  'Represent loading with aria-busy and disable actions that cannot be repeated. A disabled web button leaves the tab order; use an explanatory status nearby when the reason matters. Native surfaces should use their platform disabled and busy traits.',
  () => (
    <div className="grid max-w-md gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button aria-busy="true" disabled>
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          Saving project…
        </Button>
        <Button disabled variant="outline">
          Connect account
        </Button>
      </div>
      <p role="status" aria-live="polite" className={helpClass}>
        Saving the project settings. This preview does not contact a runtime.
      </p>
    </div>
  ),
)

export const KeyboardFocusAndOrder = note(
  'Tab through the controls to inspect the visible focus ring; Shift+Tab moves backward. Buttons activate with Enter or Space, checkboxes and switches toggle with Space, and text fields retain browser editing keys. Avoid removing the focus indicator. React Native controls use platform focus and accessibility navigation behavior.',
  () => (
    <div className="grid max-w-md gap-4 rounded-lg border bg-card p-4">
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-focus-name">
          Project name
        </label>
        <Input id="primitive-focus-name" defaultValue="Field notes" />
      </div>
      <CheckboxRow id="primitive-focus-copy" label="Include local Git history" defaultChecked />
      <Button variant="outline">Review changes</Button>
      <Button>Save project</Button>
    </div>
  ),
)

export const InputAnatomyAndAffordances: StoryObj = {
  render: () => <InputAnatomyExample />,
  parameters: {
    docs: {
      description: {
        story:
          'Inputs need a programmatic label; placeholders are examples, not labels. Put clear or reveal actions in separate named buttons. Type=email provides browser validation and keyboard hints; Input has no built-in size prop, so compose a taller field with className. Mobile fields use platform selection handles and keyboard affordances.',
      },
    },
  },
}

function InputAnatomyExample() {
  const [query, setQuery] = useState('runtime')
  return (
    <div className="grid max-w-md gap-5">
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-project-search">
          Find a project
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="primitive-project-search"
            className="pl-9 pr-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby="primitive-project-search-help"
          />
          {query && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Clear project search"
              className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
              onClick={() => setQuery('')}
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </div>
        <p id="primitive-project-search-help" className={helpClass}>
          Search project names on this computer.
        </p>
      </div>
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-runtime-url">
          Runtime address
        </label>
        <Input
          id="primitive-runtime-url"
          type="url"
          autoComplete="url"
          placeholder="http://192.168.1.20:5235"
        />
        <p className={helpClass}>HTTP works on a private LAN or VPN connection.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={fieldClass}>
          <label className={labelClass} htmlFor="primitive-email">
            Email address
          </label>
          <Input
            id="primitive-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>
        <div className={fieldClass}>
          <label className={labelClass} htmlFor="primitive-comfort-input">
            Comfortable height
          </label>
          <Input
            id="primitive-comfort-input"
            className="h-10 px-3 text-sm"
            placeholder="Optional name"
          />
        </div>
      </div>
    </div>
  )
}

export const InputValidationAndReadOnly = note(
  'Connect inline help and errors with aria-describedby, and mark invalid input with aria-invalid. Read-only values remain focusable and selectable; disabled values are unavailable to interaction. Native implementations should announce errors and read-only state through platform accessibility APIs.',
  () => (
    <div className="grid max-w-md gap-5">
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-invalid-address">
          Runtime address
        </label>
        <Input
          id="primitive-invalid-address"
          aria-invalid="true"
          aria-describedby="primitive-invalid-address-error"
          defaultValue="not a URL"
        />
        <p
          id="primitive-invalid-address-error"
          className="flex items-center gap-1.5 text-xs text-destructive"
        >
          <CircleAlert aria-hidden="true" className="size-3.5" />
          Enter an address such as http://192.168.1.20:5235.
        </p>
      </div>
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-device-id">
          Paired device ID
        </label>
        <Input id="primitive-device-id" readOnly value="device-84a2" />
        <p className={helpClass}>This value can be selected and copied.</p>
      </div>
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-managed-name">
          Managed by your organization
        </label>
        <Input id="primitive-managed-name" disabled value="Engineering team" />
      </div>
    </div>
  ),
)

export const TextareaAnatomy: StoryObj = {
  render: () => <TextareaAnatomyExample />,
  parameters: {
    docs: {
      description: {
        story:
          'Use a visible label, a short description, and a deliberate resize policy. This story also shows invalid and disabled states. A multiline web field supports normal text editing and line navigation; native text areas use platform text selection and keyboard behavior.',
      },
    },
  },
}

function TextareaAnatomyExample() {
  const [value, setValue] = useState('Summarize the changes before opening a pull request.')
  return (
    <div className="grid max-w-lg gap-5">
      <div className="grid gap-1.5">
        <label className={labelClass} htmlFor="primitive-review-note">
          Review instructions
        </label>
        <Textarea
          id="primitive-review-note"
          rows={4}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby="primitive-review-note-help primitive-review-note-count"
          placeholder="Add context for the reviewer"
        />
        <p id="primitive-review-note-help" className={helpClass}>
          Keep the request focused on changes in this project.
        </p>
        <p id="primitive-review-note-count" className={`${helpClass} text-right`}>
          {value.length} / 240 characters
        </p>
      </div>
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-empty-prompt">
          Task request
        </label>
        <Textarea
          id="primitive-empty-prompt"
          aria-invalid="true"
          aria-describedby="primitive-prompt-error"
          placeholder="Describe the change"
          value=""
          readOnly
        />
        <p id="primitive-prompt-error" className="text-xs text-destructive">
          Add a request before starting the task.
        </p>
      </div>
      <div className={fieldClass}>
        <label className={labelClass} htmlFor="primitive-generated-summary">
          Generated summary
        </label>
        <Textarea
          id="primitive-generated-summary"
          disabled
          value="Waiting for the task to finish…"
        />
      </div>
    </div>
  )
}

export const CheckboxStates = note(
  'Checkbox supports unchecked, checked, and the mixed state used when a group is partly selected. A checkbox toggles with Space when focused; Tab moves between controls. Use a visible label and describe the mixed state in words when it affects meaning. Native checkboxes follow platform selection and accessibility state conventions.',
  () => (
    <div className="grid max-w-sm gap-4">
      <CheckboxRow id="primitive-check-unchecked" label="Include ignored files" />
      <CheckboxRow id="primitive-check-checked" label="Remember this computer" defaultChecked />
      <CheckboxRow
        id="primitive-check-mixed"
        label="Select all projects"
        checked="indeterminate"
        description="Some projects are selected."
      />
      <CheckboxRow id="primitive-check-disabled" label="Managed option" disabled checked />
    </div>
  ),
)

function CheckboxRow({
  id,
  label,
  description,
  ...props
}: {
  id: string
  label: string
  description?: string
} & ComponentProps<typeof Checkbox>) {
  const descriptionId = `${id}-description`
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        aria-describedby={description ? descriptionId : undefined}
        className="mt-0.5"
        {...props}
      />
      <div className="grid gap-1">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium leading-tight">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className={helpClass}>
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

export const CheckboxGroupAndValidation = note(
  'Group related checkboxes in a fieldset with a legend. Individual choices remain independently toggleable, and Space changes the focused checkbox. This local example does not save preferences or contact a runtime.',
  () => <ProjectCopyOptions />,
)

function ProjectCopyOptions() {
  const [includeGit, setIncludeGit] = useState(true)
  const [includeConfig, setIncludeConfig] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const canCopy = includeGit || includeConfig
  return (
    <form
      className="grid max-w-md gap-4 rounded-lg border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault()
        setAttempted(true)
      }}
    >
      <fieldset
        className="grid gap-4"
        aria-describedby={attempted && !canCopy ? 'copy-options-error' : undefined}
      >
        <legend className="mb-1 text-sm font-semibold">Project copy contents</legend>
        <CheckboxRow
          id="copy-git-history"
          label="Local Git history"
          description="Branches, commits, and local changes."
          checked={includeGit}
          onCheckedChange={(checked) => setIncludeGit(checked === true)}
        />
        <CheckboxRow
          id="copy-private-config"
          label="Private configuration"
          description="Files that may contain local credentials."
          checked={includeConfig}
          onCheckedChange={(checked) => setIncludeConfig(checked === true)}
        />
      </fieldset>
      {attempted && !canCopy && (
        <p id="copy-options-error" role="alert" className="text-xs text-destructive">
          Select at least one copy option.
        </p>
      )}
      <Button type="submit" disabled={!canCopy}>
        Prepare copy
      </Button>
      {attempted && canCopy && (
        <p role="status" className={helpClass}>
          Copy options are ready. No files were copied.
        </p>
      )}
    </form>
  )
}

export const SwitchStates = note(
  'A switch represents an immediate on/off setting, not one choice among many. It toggles with Space and exposes checked state through its switch role. Keep the label stable as the state changes; describe consequences separately. Native platforms use their native switch role and accessibility value.',
  () => (
    <div className="grid max-w-md gap-4">
      <SwitchRow id="primitive-switch-off" label="Enable notifications" />
      <SwitchRow id="primitive-switch-on" label="Connect automatically" defaultChecked />
      <SwitchRow id="primitive-switch-disabled" label="Managed by administrator" disabled />
    </div>
  ),
)

function SwitchRow({
  id,
  label,
  description,
  ...props
}: {
  id: string
  label: string
  description?: string
} & ComponentProps<typeof Switch>) {
  const descriptionId = `${id}-description`
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
      <div className="grid gap-1">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className={helpClass}>
            {description}
          </p>
        )}
      </div>
      <Switch id={id} aria-describedby={description ? descriptionId : undefined} {...props} />
    </div>
  )
}

export const SwitchSettingsForm = note(
  'Use a switch for an immediate preference and a checkbox for a form choice that is committed with Submit. This example uses controlled state and a polite status message; no preference is persisted. Native settings screens typically use platform-native switches.',
  () => <NotificationSettings />,
)

function NotificationSettings() {
  const [enabled, setEnabled] = useState(true)
  return (
    <div className="grid max-w-md gap-3">
      <SwitchRow
        id="primitive-switch-notifications"
        label="Desktop notifications"
        description="Show a notification when a task needs your input."
        checked={enabled}
        onCheckedChange={setEnabled}
      />
      <p role="status" aria-live="polite" className={helpClass}>
        Notifications are {enabled ? 'on' : 'off'} in this preview.
      </p>
    </div>
  )
}

export const SelectGroupsAndKeyboard = note(
  'Select is a single-value chooser with a visible label and optional description. On web, focus the trigger and use Space, Enter, or ArrowDown to open; use arrows to move, Enter to choose, and Escape to close. It follows the Radix listbox pattern rather than native HTML select. Mobile product screens use native selection controls and platform picker behavior.',
  () => (
    <div className="grid max-w-sm gap-1.5">
      <label className={labelClass} htmlFor="primitive-select-agent">
        Default agent
      </label>
      <Select defaultValue="codex">
        <SelectTrigger id="primitive-select-agent" aria-describedby="primitive-select-agent-help">
          <SelectValue placeholder="Choose an agent" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Available agents</SelectLabel>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="mistral">Mistral Vibe</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Other</SelectLabel>
            <SelectItem value="manual">Choose manually</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <p id="primitive-select-agent-help" className={helpClass}>
        You can change the agent for each task.
      </p>
    </div>
  ),
)

export const SelectDisabledAndInvalid = note(
  'A disabled select cannot be opened and should have an adjacent reason if that state is not obvious. Connect validation help with aria-describedby on the trigger and expose aria-invalid for assistive technology.',
  () => (
    <div className="grid max-w-sm gap-5">
      <div className="grid gap-1.5">
        <label className={labelClass} htmlFor="primitive-disabled-select">
          Project region
        </label>
        <Select disabled>
          <SelectTrigger id="primitive-disabled-select">
            <SelectValue placeholder="Not available" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">Local</SelectItem>
          </SelectContent>
        </Select>
        <p className={helpClass}>Choose a destination before selecting a region.</p>
      </div>
      <div className="grid gap-1.5">
        <label className={labelClass} htmlFor="primitive-invalid-select">
          Runtime
        </label>
        <Select defaultValue="">
          <SelectTrigger
            id="primitive-invalid-select"
            aria-invalid="true"
            aria-describedby="primitive-invalid-select-error"
          >
            <SelectValue placeholder="Choose a runtime" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">This computer</SelectItem>
            <SelectItem value="paired">Paired computer</SelectItem>
          </SelectContent>
        </Select>
        <p id="primitive-invalid-select-error" className="text-xs text-destructive">
          Select where this task should run.
        </p>
      </div>
    </div>
  ),
)

export const DialogConfirmation: StoryObj = {
  render: () => <ConfirmationDialog />,
  parameters: {
    docs: {
      description: {
        story:
          'Use a dialog for a focused task that needs a decision. Include a title and description, keep a clear cancel action, and let the primitive manage focus containment, Escape dismissal, and focus return. Web uses a modal dialog; native apps should use platform modal and back-button conventions.',
      },
    },
  },
}

function ConfirmationDialog() {
  const [confirmed, setConfirmed] = useState(false)
  return (
    <div className="grid justify-items-start gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Disconnect computer</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect this computer?</DialogTitle>
            <DialogDescription>
              This removes the saved connection from this device. You can pair it again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <DialogClose asChild>
              <Button onClick={() => setConfirmed(true)}>Disconnect</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmed && (
        <p role="status" className={helpClass}>
          Confirmation recorded locally. No computer was disconnected.
        </p>
      )}
    </div>
  )
}

export const DialogDestructiveConfirmation = note(
  'Destructive confirmation names the object and explains the impact before presenting the destructive action. The primary action should use the destructive variant; cancellation is a separate close button. No deletion is performed in this story.',
  () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “Field notes” and its history?</DialogTitle>
          <DialogDescription>
            The project entry and task histories will be removed. Project folders and worktree files
            stay on disk.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep project</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="destructive">Delete project and history</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
)

export const TooltipForIconAction = note(
  'A tooltip adds a short hint to a control but does not replace its accessible name. It appears on hover and keyboard focus; the trigger remains a named button. Touch users may not have hover, and native controls should use platform hints or visible helper text instead.',
  () => (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="outline" aria-label="Copy runtime address">
            <Copy aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Copy address</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ),
)

export const BadgeVariantsAndStatus = note(
  'Badge is a visual label, not an interactive control or a live status announcement by itself. Pair important dynamic status with role=status or role=alert on the containing message. Native clients should use text and platform status semantics rather than assuming the web badge styling carries over.',
  () => (
    <div className="grid max-w-lg gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>Connected</Badge>
        <Badge variant="secondary">Draft</Badge>
        <Badge variant="outline">Local</Badge>
        <Badge variant="destructive">Needs attention</Badge>
      </div>
      <div role="status" className="flex items-center gap-2 text-sm">
        <Badge variant="secondary">
          <Check aria-hidden="true" className="mr-1 size-3" />
          Saved
        </Badge>
        <span>Runtime settings are saved on this computer.</span>
      </div>
      <div role="alert" className="flex items-center gap-2 text-sm">
        <Badge variant="destructive">Offline</Badge>
        <span>The paired computer did not respond.</span>
      </div>
    </div>
  ),
)

export const PrimitiveFormComposition = note(
  'This compact form combines labeled inputs, a checkbox, select, switch, and explicit actions. Native HTML form submission and keyboard behavior remain available. Mobile apps should map each field to native controls and preserve labels, descriptions, errors, and state rather than copying web markup.',
  () => <RuntimeSetupForm />,
)

function RuntimeSetupForm() {
  const [httpAllowed, setHttpAllowed] = useState(true)
  const [remember, setRemember] = useState(false)
  const [saved, setSaved] = useState(false)
  return (
    <form
      className="grid max-w-lg gap-5 rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(true)
      }}
    >
      <div>
        <h2 className="font-semibold">Add a runtime</h2>
        <p className={`${helpClass} mt-1`}>Connect to a computer on your private network.</p>
      </div>
      <div className={fieldClass}>
        <label htmlFor="primitive-setup-name" className={labelClass}>
          Name
        </label>
        <Input id="primitive-setup-name" required placeholder="Studio desktop" />
      </div>
      <div className={fieldClass}>
        <label htmlFor="primitive-setup-address" className={labelClass}>
          Runtime address
        </label>
        <Input
          id="primitive-setup-address"
          type="url"
          required
          defaultValue="http://192.168.1.20:5235"
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="primitive-setup-network" className={labelClass}>
          Network
        </label>
        <Select defaultValue="lan">
          <SelectTrigger id="primitive-setup-network">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lan">Private LAN</SelectItem>
            <SelectItem value="vpn">VPN</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <SwitchRow
        id="primitive-setup-http"
        label="Allow HTTP on private network"
        description="HTTP remains available for LAN and VPN connections."
        checked={httpAllowed}
        onCheckedChange={setHttpAllowed}
      />
      <CheckboxRow
        id="primitive-setup-remember"
        label="Remember this runtime"
        checked={remember}
        onCheckedChange={(checked) => setRemember(checked === true)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button type="button" variant="ghost" onClick={() => setSaved(false)}>
          Cancel
        </Button>
        <Button type="submit">
          <Plus aria-hidden="true" />
          Add runtime
        </Button>
      </div>
      {saved && (
        <p role="status" className="text-sm text-muted-foreground">
          Setup is valid. This story makes no network request.
        </p>
      )}
    </form>
  )
}
