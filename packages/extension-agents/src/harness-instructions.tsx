import { useWorkspace, useSettingsDraft, useConfirmation } from '@dovo/studio-core'
import { useHarnessInstructions } from '@dovo/studio-core/harness-instructions'
import { providerDisplayName, runtimeComputerName } from '@dovo/protocol'
import { Button, ChoicePicker, Disclosure, FormField, Textarea } from '@dovo/studio-ui'
import { useState } from 'react'

export function HarnessInstructions() {
  const { request, connected, snapshot, activeRuntimeId, connection } = useWorkspace()
  const [opened, setOpened] = useState(false)
  const editor = useHarnessInstructions({
    scope: JSON.stringify([activeRuntimeId, connection]),
    request,
    connected,
    supported: snapshot?.harnessInstructionsSupported === true && opened,
  })
  useSettingsDraft(editor.dirty, editor.busy)
  const confirm = useConfirmation(
    JSON.stringify([activeRuntimeId, editor.selected?.id, editor.draft]),
  )
  const file = editor.selected
  const draft = editor.draft
  return (
    <Disclosure
      title="Harness instruction files"
      data-setting-label="Harness instruction files"
      onToggle={(event) => {
        if (event.currentTarget.open) setOpened(true)
      }}
    >
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Edit the files each harness reads on {runtimeComputerName({ snapshot })}. Files can be
          shared by several profiles. Review the diff before saving.
        </p>
        {snapshot?.harnessInstructionsSupported !== true ? (
          <p role="status" className="text-xs text-muted-foreground">
            Update Dovo on this computer to edit harness instruction files.
          </p>
        ) : (
          <>
            <FormField label="Instruction file">
              <ChoicePicker
                aria-label="Harness instruction file"
                value={file?.id ?? ''}
                disabled={editor.disabled || !editor.files.length}
                onValueChange={editor.select}
              >
                {!editor.files.length && (
                  <option value="">
                    {editor.loading ? 'Loading files…' : 'No files available'}
                  </option>
                )}
                {editor.files.map((item) => (
                  <option key={item.id} value={item.id}>
                    {providerDisplayName(item.provider)} · {item.name} · {item.profiles.join(', ')}
                  </option>
                ))}
              </ChoicePicker>
            </FormField>
            {file && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="break-all font-mono">{file.path}</p>
                {draft && draft.resolvedPath !== file.path && (
                  <p className="break-all">Linked file: {draft.resolvedPath}</p>
                )}
                <p>{file.description}</p>
                {draft && !draft.exists && <p>This file does not exist yet. Saving creates it.</p>}
              </div>
            )}
            <Textarea
              aria-label="Harness instructions"
              className="min-h-64 font-mono text-xs"
              value={draft?.text ?? ''}
              disabled={editor.disabled || !draft}
              onChange={(event) => editor.text(event.target.value)}
            />
            {draft?.diff && (
              <pre
                aria-label="Harness instruction diff"
                className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 font-mono text-xs"
              >
                {draft.diff}
              </pre>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={editor.disabled || !draft}
                onClick={() => void editor.review()}
              >
                Review diff
              </Button>
              <Button
                size="sm"
                disabled={editor.disabled || !draft?.reviewed}
                onClick={() => void editor.save()}
              >
                Save instruction file
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={editor.disabled || !file}
                onClick={() => void editor.reload()}
              >
                Reload disk version
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={editor.disabled || !draft || draft.text === draft.original}
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Discard instruction draft?',
                      description:
                        'Your edits to this file will be removed. The file on disk stays unchanged.',
                      confirmLabel: 'Discard draft',
                      destructive: true,
                    })
                  )
                    editor.reset()
                }}
              >
                Discard draft
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Reload keeps your draft for a new diff review. Start a new harness session to use
              saved changes.
            </p>
            <Button variant="ghost" size="sm" disabled={editor.disabled} onClick={editor.retry}>
              Reload file list
            </Button>
          </>
        )}
        {editor.error && (
          <p role="alert" className="text-xs text-destructive">
            {editor.error}
          </p>
        )}
        {editor.notice && (
          <p role="status" className="text-xs text-muted-foreground">
            {editor.notice}
          </p>
        )}
        {!connected && (
          <p role="status" className="text-xs text-muted-foreground">
            Reconnect this computer to read or save files. Your drafts are kept.
          </p>
        )}
        {editor.notices.map((notice) => (
          <p key={notice} role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        ))}
      </div>
    </Disclosure>
  )
}
