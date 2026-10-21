import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ChoicePicker } from '../../../packages/studio-ui/src/choice-picker'
import { Button } from '../../../packages/studio-ui/src/components/ui/button'

const meta = {
  title: 'Dovo/Selection',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The actual searchable choice dialog used by product settings. Search text is not a selected value. Disabled options remain visible but cannot be chosen; no-results text must distinguish an empty search from an empty account.',
      },
    },
  },
} satisfies Meta
export default meta
function SearchableExample({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('local')
  return (
    <section className="grid max-w-lg gap-4">
      <h2 className="text-lg font-semibold">Choose a computer</h2>
      <ChoicePicker
        aria-label="Computer"
        value={value}
        onValueChange={setValue}
        disabled={disabled}
      >
        <option value="local">This computer</option>
        <option value="macbook">MacBook Pro · Private LAN / VPN</option>
        <option value="agent">dovo-agent · Dovo Connect</option>
        <option value="offline" disabled>
          Build server · Offline
        </option>
      </ChoicePicker>
      <p role="status" className="text-sm text-muted-foreground">
        Selected computer: {value}
      </p>
      <p className="text-sm text-muted-foreground">
        Open the dialog, search, then use arrows and Enter to choose. Escape dismisses without
        changing the selection. This story never connects to a computer.
      </p>
      <Button variant="outline" onClick={() => setValue('local')}>
        Reset selection
      </Button>
    </section>
  )
}
export const SearchableChoice: StoryObj = { render: () => <SearchableExample /> }
export const DisabledChoice: StoryObj = { render: () => <SearchableExample disabled /> }
function LongOptionsExample() {
  const [value, setValue] = useState('team')
  return (
    <section className="grid max-w-lg gap-4">
      <h2 className="text-lg font-semibold">Long labels and groups</h2>
      <ChoicePicker aria-label="Project workspace" value={value} onValueChange={setValue}>
        <optgroup label="Paired computers">
          <option value="team">
            Shared product workspace — desktop, mobile, account services and artifacts
          </option>
          <option value="path">
            /Users/example/Projects/customer-project-with-a-long-name/frontend
          </option>
        </optgroup>
        <optgroup label="Other">
          <option value="general">General</option>
        </optgroup>
      </ChoicePicker>
      <p className="break-all text-sm text-muted-foreground">Selected workspace: {value}</p>
    </section>
  )
}
export const LongOptions: StoryObj = { render: () => <LongOptionsExample /> }
