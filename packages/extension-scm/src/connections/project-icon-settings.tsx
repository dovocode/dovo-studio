import { Schema } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import { projectIcon, projectIconChoices, sharedProjectKey } from '@dovo/protocol'
import { useWorkspace, type Repository } from '@dovo/studio-core'
import { Button, Popover, ProjectIcon } from '@dovo/studio-ui'

export function ProjectIconSettings({ repository }: { repository: Repository }) {
  const { request, connected, refreshRuntime, runtimes, activeRuntimeId } = useWorkspace()
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [picker, setPicker] = useApplicationState(false)
  const save = async (iconOverride: string | undefined) => {
    const profile = runtimes.find((entry) => entry.profile.id === activeRuntimeId)?.profile
    if (!profile) return
    setBusy(true)
    setError('')
    try {
      await request(
        '/api/scm/repositories/icon',
        { repositoryId: repository.id, data: iconOverride?.split(',')[1] },
        Schema.Struct({ ok: Schema.Literal(true) }),
      )
      await refreshRuntime(profile)
      setPicker(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const upload = async (file: File) => {
    setError('')
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose an image smaller than 2 MB.')
      const image = await createImageBitmap(file)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 48
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Image editing is unavailable.')
        const scale = Math.min(48 / image.width, 48 / image.height)
        const width = image.width * scale,
          height = image.height * scale
        context.drawImage(image, (48 - width) / 2, (48 - height) / 2, width, height)
        const value = canvas.toDataURL('image/png')
        if (value.length > 50000) throw new Error('This image is too detailed for a task icon.')
        await save(value)
      } finally {
        image.close()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
      <ProjectIcon repository={repository} className="size-9 rounded-lg text-sm" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">Project icon</p>
        <p className="text-xs text-muted-foreground">
          Used for every task in this project.{' '}
          {sharedProjectKey(repository)
            ? 'Icons sync across paired computers with the same Git remote.'
            : 'This project’s icon stays on this computer.'}{' '}
          {repository.iconOverride
            ? 'Custom image.'
            : projectIcon(repository)
              ? 'Detected from the checkout.'
              : 'No local icon found.'}
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      <Popover.Root open={picker} onOpenChange={setPicker}>
        <Popover.Trigger asChild>
          <Button size="sm" variant="outline" disabled={!connected || busy}>
            Icon or emoji
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            aria-label="Choose project icon"
            className="z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-3 shadow-lg"
          >
            {(['icon', 'emoji'] as const).map((kind) => (
              <div key={kind} className="mb-3 last:mb-0">
                <p className="mb-2 text-xs font-medium">{kind === 'icon' ? 'Icons' : 'Emoji'}</p>
                <div className="grid grid-cols-8 gap-1">
                  {projectIconChoices
                    .filter((choice) => choice.kind === kind)
                    .map((choice) => (
                      <Button
                        key={choice.id}
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={`${kind === 'icon' ? 'Icon' : 'Emoji'}: ${choice.label}`}
                        disabled={busy || !connected}
                        onClick={() => void save(choice.data)}
                      >
                        <img src={choice.data} alt="" className="size-7" />
                      </Button>
                    ))}
                </div>
              </div>
            ))}
            {error && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {error}
              </p>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <label className="cursor-pointer rounded-md border px-2 py-1.5 text-xs hover:bg-accent">
        Choose image
        <input
          type="file"
          disabled={!connected || busy}
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
            event.target.value = ''
          }}
        />
      </label>
      {repository.iconOverride && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected || busy}
          onClick={() => void save(undefined)}
        >
          Reset
        </Button>
      )}
    </section>
  )
}
