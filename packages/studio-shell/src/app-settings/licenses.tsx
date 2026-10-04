import { useState } from 'react'
import { Button, Dialog, DialogContent, DialogTitle, DialogDescription } from '@dovo/studio-ui'
import aiElements from '../../../studio-ui/licenses/ai-elements.txt?raw'
import shadcn from '../../../studio-ui/licenses/shadcn-ui.txt?raw'
import simulatorProtocols from '../../../../docs/licenses/simulator-protocols.md?raw'
import idb from '../../../../docs/licenses/idb-MIT.txt?raw'
import apache from '../../../../docs/licenses/Apache-2.0.txt?raw'
import { SettingRow } from './layout'
const notices = [
  ['AI Elements', aiElements],
  ['shadcn/ui', shadcn],
  ['Simulator protocols', simulatorProtocols],
  ['idb companion', idb],
  ['Apache License 2.0', apache],
] as const
export function LicenseSettingsRow() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <SettingRow
        label="Open source notices"
        description="License notices for adapted UI components and optional simulator tools."
      >
        <Button variant="outline" onClick={() => setOpen(true)}>
          View notices
        </Button>
      </SettingRow>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogTitle>Open source notices</DialogTitle>
          <DialogDescription>
            Notices included with Dovo’s adapted components and optional tools.
          </DialogDescription>
          {notices.map(([name, text]) => (
            <details key={name}>
              <summary className="cursor-pointer text-sm font-medium">{name}</summary>
              <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {text}
              </pre>
            </details>
          ))}
        </DialogContent>
      </Dialog>
    </>
  )
}
