import { useState, type ReactNode } from 'react'
import { queueTemplateSource, type Task } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useQueueTemplates } from '@dovo/studio-core/queue-templates'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from '@dovo/studio-ui'

export function QueueTemplates({
  task,
  children,
  onCloseAutoFocus,
}: {
  task: Task
  onCloseAutoFocus?: (event: Event) => void
  children: (action?: { disabled: boolean; open: boolean; show: () => void }) => ReactNode
}) {
  const text = useInterfaceText()
  const { request, connected, snapshot, workspace } = useWorkspace()
  const templates = useQueueTemplates(task.id, task.repositoryId, request, request)
  const [name, setName] = useState('')
  const [deleting, setDeleting] = useState('')
  const available =
    snapshot?.queueTemplatesSupported &&
    !task.archived &&
    !task.archivedAt &&
    !task.machineHandoff &&
    workspace.repositories.some((project) => project.id === task.repositoryId)
  const source = templates.open
    ? queueTemplateSource(workspace.tasks.find((item) => item.id === task.id)?.queue ?? [])
    : undefined
  const disabled = templates.busy || !connected
  const confirmDelete = deleting === templates.selected?.id
  return (
    <>
      {children(
        available
          ? { disabled: !connected, open: templates.open, show: templates.show }
          : undefined,
      )}
      {available && templates.open && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) templates.close()
          }}
        >
          <DialogContent
            className="max-h-[85dvh] overflow-auto"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <DialogHeader>
              <DialogTitle>{text('Queue templates')}</DialogTitle>
              <DialogDescription>
                {text('Add editable messages in order. The queue stays paused until you run it.')}
              </DialogDescription>
            </DialogHeader>
            {templates.error && (
              <p role="alert" className="text-destructive">
                {templates.error}
              </p>
            )}
            {templates.busy && <p role="status">{text('Working…')}</p>}
            {templates.templates === undefined && templates.error && (
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => void templates.refresh()}
              >
                {text('Retry')}
              </Button>
            )}
            {templates.templates?.length === 0 && (
              <p>{text('No queue templates for this project.')}</p>
            )}
            {!!templates.templates?.length && (
              <ChoicePicker
                aria-label={text('Template')}
                value={templates.selected?.id ?? ''}
                onValueChange={(id) => {
                  setDeleting('')
                  templates.select(id)
                }}
                disabled={disabled}
              >
                {templates.templates.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </ChoicePicker>
            )}
            {templates.selected && (
              <>
                <ol className="max-h-52 list-decimal space-y-2 overflow-auto pl-6">
                  {templates.selected.steps.map((step, index) => (
                    <li key={index} className="whitespace-pre-wrap break-words">
                      {step}
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={disabled} onClick={() => void templates.stage()}>
                    {text('Add template to queue')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      if (confirmDelete) void templates.remove()
                      else if (templates.selected) setDeleting(templates.selected.id)
                    }}
                  >
                    {text(confirmDelete ? 'Confirm delete' : 'Delete template')}
                  </Button>
                  {confirmDelete && (
                    <Button type="button" variant="ghost" onClick={() => setDeleting('')}>
                      {text('Cancel')}
                    </Button>
                  )}
                </div>
              </>
            )}
            <form
              className="space-y-2 border-t pt-3"
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (source && name.trim() && !disabled)
                  void templates.save(name, source.fingerprint)
              }}
            >
              <label htmlFor={`queue-template-name-${task.id}`}>{text('Template name')}</label>
              <Input
                id={`queue-template-name-${task.id}`}
                value={name}
                maxLength={80}
                disabled={!source || disabled}
                onChange={(event) => setName(event.target.value)}
              />
              {!source && (
                <p className="text-sm text-muted-foreground">
                  {text('Queue plain-text messages to save a template.')}
                </p>
              )}
              <Button
                type="submit"
                variant="outline"
                disabled={!name.trim() || !source || disabled}
              >
                {text('Save queue as template')}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
