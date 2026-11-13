import { constants } from 'node:fs'
import { mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import {
  botAvatarGenerateSchema,
  botAvatarPreviewSchema,
  decode,
  effectivePermissionPolicy,
  resolveTaskAgent,
  taskResources,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { skillContext } from '../execution/skill-context.js'

const maxImageBytes = 5 * 1024 * 1024

/** Store pixels only, never SVG, metadata, remote URLs or a path supplied by an agent. */
export async function botAvatarPreview(data: Buffer) {
  if (data.length > maxImageBytes) throw new HttpError(413, 'Choose an image smaller than 5 MB.')
  const type = await fileTypeFromBuffer(data)
  if (!type || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type.mime))
    throw new HttpError(415, 'Choose a PNG, JPEG, WebP or GIF image.')
  try {
    const thumbnail = await sharp(data, { limitInputPixels: 32 * 1024 * 1024 })
      .rotate()
      .resize(128, 128, { fit: 'cover' })
      .webp({ lossless: true })
      .toBuffer()
    return decode(botAvatarPreviewSchema, {
      avatar: `data:image/webp;base64,${thumbnail.toString('base64')}`,
    })
  } catch {
    throw new HttpError(415, 'Could not read this avatar. Choose another image.')
  }
}

/** One-off provider sessions use the Bot's tools and access, without entering its conversation. */
export class BotAvatars {
  private running = new Map<
    string,
    { requestId: string; controller: AbortController; done: Promise<unknown> }
  >()
  private stopped = false
  constructor(
    private s: Pick<
      Services,
      'store' | 'agents' | 'defaults' | 'approvals' | 'mutations' | 'tasks'
    >,
  ) {}

  async generate(value: unknown) {
    const input = decode(botAvatarGenerateSchema, value)
    const task = this.s.store.taskSummary(input.id)
    if (!task.bot || task.archivedAt || task.replica) throw new HttpError(404, 'Bot not found.')
    if (this.stopped) throw new HttpError(503, 'The runtime is stopping.')
    return decode(
      botAvatarPreviewSchema,
      await this.s.mutations.execute(`bot-avatar:${input.id}`, input.requestId, input, async () => {
        if (this.running.has(input.id))
          throw new HttpError(409, 'An avatar is already generating for this Bot.')
        const agent = resolveTaskAgent(task, this.s.store.get().agents)
        if (!agent || effectivePermissionPolicy(agent).readOnly)
          throw new HttpError(400, 'Choose a Bot harness with tools enabled to generate an image.')
        const controller = new AbortController()
        const timer = setTimeout(
          () => controller.abort(new Error('Avatar generation timed out.')),
          5 * 60 * 1000,
        )
        const done = this.run(input.id, input.requestId, input.prompt, agent, controller)
        this.running.set(input.id, { requestId: input.requestId, controller, done })
        try {
          return await done
        } finally {
          clearTimeout(timer)
          this.running.delete(input.id)
        }
      }),
    )
  }

  cancel(id: string, requestId: string) {
    const run = this.running.get(id)
    if (run?.requestId === requestId)
      run.controller.abort(new Error('Avatar generation cancelled.'))
  }

  private async run(
    id: string,
    requestId: string,
    prompt: string,
    agent: NonNullable<ReturnType<typeof resolveTaskAgent>>,
    controller: AbortController,
  ) {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-bot-avatar-'))
    try {
      const task = this.s.store.taskSummary(id)
      const resources = taskResources(task, this.s.store.get(), this.s.defaults.get())
      // The temporary worker has no coordinator credentials or permission to manage Studio.
      resources.mcpServers = resources.mcpServers.filter((server) => server.name !== 'dovo_task')
      const adapter = await this.s.agents.get(agent.provider)
      controller.signal.throwIfAborted()
      await adapter.run({
        ephemeral: true,
        onOwnedProcess: this.s.tasks.memoryProtection.begin({
          taskId: `bot-avatar:${id}`,
          runId: requestId,
          current: () =>
            !controller.signal.aborted && this.running.get(id)?.requestId === requestId,
          stop: (reason) => controller.abort(reason),
        }),
        agent: {
          ...agent,
          resources,
          instructions: [
            'Generate one illustrated Bot avatar using an installed image-generation skill or image tool. Do not draw it with SVG, code or text. If no image tool is available, explain that and stop. Save the final raster image as avatar.png in the working directory. Do not change other files or settings, contact people, or start other jobs. The image is a preview; do not apply it to the Bot. Use only the requested design details.',
            skillContext(
              resources.skills.filter((skill) => skill.enabled),
              false,
            ),
          ].join('\n\n'),
        },
        cwd: directory,
        prompt: `Bot name: ${task.title}\nRole: ${task.bot?.role}\nDesign: ${prompt}\nCreate a square avatar that is clear at small sizes.`,
        signal: controller.signal,
        onSession: () => {},
        onActivity: () => {},
        onText: () => {},
        approve: (title, detail, kind, scopes) =>
          this.s.approvals.request(
            id,
            `Bot avatar: ${title}`,
            detail,
            controller.signal,
            kind,
            scopes,
          ),
        ask: async () => null,
      })
      controller.signal.throwIfAborted()
      const file = join(directory, 'avatar.png')
      const resolved = await realpath(file).catch(() => {
        throw new HttpError(
          422,
          'The agent did not produce avatar.png. Install an image-generation tool or skill on this computer, then generate a new preview.',
        )
      })
      const path = relative(directory, resolved)
      if (path.startsWith('..') || isAbsolute(path))
        throw new HttpError(422, 'The avatar must be generated in its temporary folder.')
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > maxImageBytes)
          throw new HttpError(413, 'Generated avatar exceeds 5 MB.')
        const data = Buffer.alloc(info.size + 1)
        let total = 0
        while (total < data.length) {
          const { bytesRead } = await handle.read(data, total, data.length - total, total)
          if (!bytesRead) break
          total += bytesRead
        }
        if (total > info.size)
          throw new HttpError(409, 'The generated image changed while reading.')
        return await botAvatarPreview(data.subarray(0, total))
      } finally {
        await handle.close()
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  async dispose() {
    this.stopped = true
    for (const run of this.running.values()) run.controller.abort(new Error('Runtime stopped.'))
    await Promise.allSettled([...this.running.values()].map((run) => run.done))
  }
}
