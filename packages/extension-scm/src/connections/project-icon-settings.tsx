import { useApplicationState } from '@dovo/studio-core/state'
import { projectIcon } from '@dovo/protocol'
import { useWorkspace, type Repository } from '@dovo/studio-core'
import { Button, ProjectIcon } from '@dovo/studio-ui'

export function ProjectIconSettings({ repository }: { repository: Repository }) {
  const { setWorkspace } = useWorkspace()
  const [error, setError] = useApplicationState('')
  const save = (iconOverride: string | undefined) =>
    setWorkspace((current) => ({
      ...current,
      repositories: current.repositories.map((item) =>
        item.id === repository.id ? { ...item, iconOverride } : item,
      ),
    }))
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
        save(value)
      } finally {
        image.close()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <section className="flex items-center gap-3 rounded-lg border p-3">
      <ProjectIcon repository={repository} className="size-9 rounded-lg text-sm" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">Project icon</p>
        <p className="text-xs text-muted-foreground">
          Used for every task in this project.{' '}
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
      <label className="cursor-pointer rounded-md border px-2 py-1.5 text-xs hover:bg-accent">
        Choose image
        <input
          type="file"
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
        <Button size="sm" variant="ghost" onClick={() => save(undefined)}>
          Reset
        </Button>
      )}
    </section>
  )
}
