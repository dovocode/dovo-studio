import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { useCodexSessionImport, useWorkspace, useStudioHost } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  ChoicePicker,
} from '@dovo/studio-ui'

export function ImportCodexSession({
  repositoryId,
  disabled,
  onNavigate,
}: {
  repositoryId: string
  disabled?: boolean
  onNavigate?: () => void
}) {
  const uiText = useInterfaceText()

  const store = useWorkspace()
  const host = useStudioHost()
  const [open, setOpen] = useState(false)
  const picker = useCodexSessionImport(store.request, repositoryId, open)
  const agents = store.workspace.agents.filter((agent) => agent.provider === 'codex')
  const navigate = (id: string) => {
    setOpen(false)
    onNavigate?.()
    host.navigate({ viewId: 'tasks', entityId: id })
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled || !store.connected}
        onClick={() => {
          picker.refresh()
          setOpen(true)
        }}
      >
        Import Codex terminal session
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!picker.importing) setOpen(value)
        }}
      >
        <DialogContent className="flex max-h-[85dvh] flex-col text-left">
          <DialogHeader>
            <DialogTitle>Import Codex terminal session</DialogTitle>
            <DialogDescription>
              Preview a session from this project on the selected computer. Exit Codex before
              importing. Send a new message after import to continue.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-xs">
            Codex configuration
            <ChoicePicker
              aria-label="Codex configuration"
              className="w-full"
              value={picker.agentId}
              disabled={picker.importing}
              onValueChange={picker.setAgentId}
            >
              <option value="">Project / default Codex home</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </ChoicePicker>
          </label>
          <Button
            className="self-end"
            variant="outline"
            size="sm"
            disabled={picker.importing}
            onClick={picker.refresh}
          >
            Refresh sessions
          </Button>
          {picker.error && (
            <p role="alert" className="text-xs text-destructive">
              {picker.error}
            </p>
          )}
          {picker.notice && <p className="text-xs text-muted-foreground">{picker.notice}</p>}
          <div className="min-h-0 overflow-y-auto space-y-3">
            {!picker.sessions ? (
              <p role="status">Finding Codex sessions…</p>
            ) : !picker.sessions.length ? (
              <p>No terminal Codex sessions found for this project and configuration.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto space-y-1" aria-label="Codex sessions">
                {picker.sessions.map((session) => (
                  <button
                    key={session.key}
                    type="button"
                    disabled={picker.importing}
                    aria-pressed={picker.selected === session.key}
                    className="w-full rounded-md border px-3 py-2 text-left text-xs hover:bg-accent aria-pressed:bg-accent"
                    onClick={() => picker.select(session.key)}
                  >
                    <span className="block truncate">
                      {session.title}
                      {session.taskId ? ' · In Dovo' : ''}
                    </span>
                    <span className="block break-all text-muted-foreground">
                      {session.cwd} · {new Date(session.updatedAt).toLocaleString()}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {picker.selected && !picker.preview && !picker.error && (
              <p role="status">Loading session preview…</p>
            )}
            {picker.preview && (
              <section aria-label="Codex session preview" className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {picker.preview.session.model || 'Native model'} ·{' '}
                  {picker.preview.session.sessionId}
                </p>
                <p role="status" className="text-sm">
                  {picker.preview.notice}
                </p>
                {!!picker.preview.olderMessages && (
                  <p className="text-xs text-muted-foreground">
                    Showing the latest 100 messages. All{' '}
                    {picker.preview.olderMessages + picker.preview.messages.length} messages will be
                    saved.
                  </p>
                )}
                {picker.preview.messages.map((message) => (
                  <article key={message.id} className="rounded-md border p-3 text-xs">
                    <p className="mb-1 font-medium">
                      {message.role === 'user' ? 'You · Imported' : 'Codex'}
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-sans">{message.text}</pre>
                  </article>
                ))}
              </section>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={picker.importing} onClick={() => setOpen(false)}>
              {uiText('Cancel')}
            </Button>
            {picker.preview?.session.taskId ? (
              <Button
                onClick={() => {
                  const id = picker.preview?.session.taskId
                  if (id) navigate(id)
                }}
              >
                Open existing thread
              </Button>
            ) : (
              <Button
                disabled={
                  picker.importing ||
                  picker.preview?.status !== 'available' ||
                  !picker.preview.messages.length ||
                  !store.connected
                }
                onClick={() => {
                  void picker.importSession().then((result) => {
                    if (result) navigate(result.id)
                  })
                }}
              >
                {picker.importing ? 'Importing…' : 'Import session'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
