import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type { DeviceDeployResult, DeviceDeployTarget, PreviewDevice } from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { appleGuiBuild } from './apple-device-command.js'
import { installNative } from './device-host-install.js'
import { previewDeviceAction, previewDevices } from './devices.js'

const exec = promisify(execFile)
const bundleId = 'com.dovo.studio'
const buildScript = 'scripts/build-ios-device.mjs'
const allowedOrigins = new Set([
  'git@github.com:dovocode/dovo-studio.git',
  'ssh://git@github.com/dovocode/dovo-studio.git',
  'https://github.com/dovocode/dovo-studio.git',
  'https://github.com/dovocode/dovo-studio',
])
function deploymentProfile() {
  const repository = process.env.DOVO_IOS_DEPLOY_REPOSITORY
  const team = process.env.DOVO_APPLE_TEAM_ID
  if (
    process.platform === 'darwin' &&
    repository &&
    isAbsolute(repository) &&
    team &&
    /^[A-Z0-9]{10}$/.test(team)
  )
    return { repository, team }
}

export function iosDeployDevices<T extends { devices: PreviewDevice[] }>(result: T): T {
  if (deploymentProfile()) {
    for (const device of result.devices)
      if (device.platform === 'ios' && device.kind === 'physical') device.iosDeploySupported = true
  }
  return result
}

type Build = {
  repository: string
  directory: string
  checkout: string
  app: string
  revision: string
  buildNumber: number
}
type Deployment = DeviceDeployTarget & { taskId: string }
const command = (file: string, args: string[], signal?: AbortSignal) =>
  exec(file, args, { signal, timeout: 120000, maxBuffer: 1024 * 1024 })
const git = (repository: string, args: string[], signal?: AbortSignal) =>
  command('git', ['-C', repository, ...args], signal)

async function removeBuild(build: Build) {
  // The worktree belongs to this operation. Its generated native files are disposable.
  await git(build.repository, ['worktree', 'remove', '--force', build.checkout]).catch(() => {})
  await rm(build.directory, { recursive: true, force: true })
}

function deploymentMessage(error: unknown, signal: AbortSignal, installed: boolean) {
  if (signal.aborted)
    return installed
      ? 'The app was installed before deployment was cancelled. Launch is unconfirmed.'
      : 'Deployment was cancelled. Check the installed build before retrying.'
  if (error instanceof HttpError) return error.message
  return installed
    ? 'The app was installed. Unlock the iPhone and try launching it from Device Hub.'
    : 'Installation could not be confirmed. Connect and unlock the iPhone, then retry.'
}

/** One signed build at a time on the owning Mac. Keep the last artifact for a reconnect. */
export class IosDeviceDeploy {
  private active?: Promise<DeviceDeployResult>
  private controller?: AbortController
  private build?: Build

  run(input: Deployment, signal: AbortSignal, authorize: () => void) {
    if (this.active) throw new HttpError(409, 'An iPhone deployment is already running on this Mac')
    const controller = new AbortController()
    this.controller = controller
    const combined = AbortSignal.any([signal, controller.signal])
    const operation = this.deploy(input, combined, () => {
      combined.throwIfAborted()
      authorize()
    })
    this.active = operation
    return operation.finally(() => {
      this.active = undefined
      this.controller = undefined
    })
  }

  private async deploy(input: Deployment, signal: AbortSignal, authorize: () => void) {
    authorize()
    const profile = deploymentProfile()
    if (!profile)
      throw new HttpError(409, 'Set up signed iPhone deployment on the owning Mac first.')
    const { repository, team } = profile
    if (!input.id.startsWith('physical-ios:'))
      throw new HttpError(400, 'Choose a physical iPhone from Device Hub.')

    let installed = false
    try {
      const device = (await previewDevices(input.id)).devices.find((entry) => entry.id === input.id)
      if (!device || device.kind !== 'physical' || device.platform !== 'ios')
        throw new HttpError(404, 'This iPhone is no longer paired with the Mac.')
      const origin = (await git(repository, ['remote', 'get-url', 'origin'], signal)).stdout.trim()
      if (!allowedOrigins.has(origin))
        throw new HttpError(409, 'The Mac deployment checkout must use the Dovo Studio origin.')

      let build = this.build
      if (
        build?.revision !== input.revision ||
        build.buildNumber !== input.buildNumber ||
        build.repository !== repository
      ) {
        authorize()
        if (build) await removeBuild(build)
        this.build = undefined
        build = await this.prepare(repository, team, input, signal)
        this.build = build
      }
      authorize()
      await installNative(device.id, build.app, authorize, signal)
      installed = true
      authorize()
      await previewDeviceAction(
        { taskId: input.taskId, id: input.id, action: 'relaunch', bundleId },
        signal,
        authorize,
      )
      return { installed, launched: true, message: 'Installed and launched Dovo Studio.' }
    } catch (error) {
      return { installed, launched: false, message: deploymentMessage(error, signal, installed) }
    }
  }

  private async prepare(
    repository: string,
    team: string,
    input: DeviceDeployTarget,
    signal: AbortSignal,
  ) {
    const { revision, buildNumber } = input
    try {
      const { stdout } = await git(
        repository,
        ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'],
        signal,
      )
      const tip = stdout.trim().split(/\s+/)[0]
      if (!/^[a-f0-9]{40}$/.test(tip)) throw new Error('Missing main revision')
      await git(repository, ['fetch', '--no-tags', '--no-write-fetch-head', 'origin', tip], signal)
      await git(repository, ['merge-base', '--is-ancestor', revision, tip], signal)
    } catch {
      signal.throwIfAborted()
      throw new HttpError(409, 'Could not verify the requested commit on Dovo Studio main.')
    }
    const directory = await mkdtemp(join(tmpdir(), 'dovo-ios-deploy-'))
    const checkout = join(directory, 'source')
    const app = join(
      checkout,
      'work/mobile-update-build/Build/Products/Release-iphoneos/DovoStudio.app',
    )
    const build = { repository, directory, checkout, app, revision, buildNumber }
    try {
      await git(repository, ['worktree', 'add', '--detach', checkout, revision], signal)
      if (!(await stat(join(checkout, buildScript)).catch(() => undefined))?.isFile())
        throw new HttpError(409, 'Choose a revision with Device Hub iPhone build support.')
      const log = join(directory, 'build.log')
      await appleGuiBuild(
        '/bin/zsh',
        [
          '-c',
          'cd "$1" && { pnpm install --frozen-lockfile && node scripts/build-ios-device.mjs; } > "$2" 2>&1',
          'dovo-ios-build',
          checkout,
          log,
        ],
        {
          signal,
          timeout: 20 * 60 * 1000,
          maxBuffer: 64 * 1024,
          env: {
            CI: '1',
            DOVO_APPLE_TEAM_ID: team,
            DOVO_MOBILE_BUILD_NUMBER: String(buildNumber),
            DOVO_MOBILE_CHANNEL: 'nightly',
            DOVO_MOBILE_DISTRIBUTION: '0',
            DOVO_APNS_ENVIRONMENT: 'sandbox',
          },
        },
      ).catch((error: unknown) => {
        signal.throwIfAborted()
        if (
          error instanceof HttpError &&
          error.status === 409 &&
          error.message.startsWith('Sign in')
        )
          throw error
        throw new HttpError(
          409,
          'The Mac did not finish signing the build. Check Xcode, CocoaPods and the Apple Development identity on the owning Mac.',
        )
      })
      const { stdout } = await command(
        'plutil',
        ['-convert', 'json', '-o', '-', join(app, 'Info.plist')],
        signal,
      )
      const info = JSON.parse(stdout)
      const config = JSON.parse(await readFile(join(app, 'EXConstants.bundle/app.config'), 'utf8'))
      if (
        info.CFBundleIdentifier !== bundleId ||
        info.CFBundleVersion !== String(buildNumber) ||
        config.extra?.sourceCommit !== revision ||
        config.extra?.releaseChannel !== 'nightly'
      )
        throw new HttpError(
          409,
          'The signed iPhone app does not match the requested commit and build.',
        )
      await command('codesign', ['--verify', '--deep', '--strict', app], signal)
      return build
    } catch (error) {
      await removeBuild(build)
      signal.throwIfAborted()
      if (error instanceof HttpError) throw error
      throw new HttpError(409, 'The Mac could not prepare the requested iPhone build.')
    }
  }

  async dispose() {
    this.cancel()
    await this.active?.catch(() => undefined)
    if (this.build) await removeBuild(this.build)
    this.build = undefined
  }

  cancel() {
    this.controller?.abort()
  }
}
