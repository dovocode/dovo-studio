import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
const device = process.argv[2]
const navigationOnly = process.argv.includes('--navigation-only')
if (!device) throw new Error('Pass an iOS simulator UUID with the native app installed')
process.env.DOVO_TEST_LONG_PULLS = '1'
process.env.DOVO_TEST_RICH_PULLS = '1'
if (navigationOnly) process.env.DOVO_TEST_MANY_PULLS = '1'
const hierarchy = JSON.parse(
  execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi'], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  }),
)
const windowBounds = hierarchy.children?.[0]?.attributes?.bounds?.match(
  /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/,
)
if (!windowBounds) throw new Error('Could not measure the simulator window for PR layout checks')
const halfContentWidth = Math.floor((Number(windowBounds[3]) - Number(windowBounds[1]) - 32) / 2)
async function verifyActionBounds(size, previous) {
  const tree = JSON.parse(
    execFileSync('maestro', ['--device', device, 'hierarchy', '--no-ansi'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }),
  )
  const nodes = []
  function visit(node) {
    if (node.attributes) nodes.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  if (nodes.some(({ attributes }) => attributes['resource-id'] === 'More PR actions'))
    throw new Error('PR details must have one consolidated actions menu')
  const bounds = ['Back', 'PR actions', 'Review'].map((label) => {
    const node = nodes.find(
      ({ attributes }) => attributes['resource-id'] === label || attributes.text === label,
    )
    const values = node?.attributes.bounds
      ?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
      ?.slice(1)
      .map(Number)
    if (!values) throw new Error(`Missing visible action bounds: ${label}`)
    const [left, top, right, bottom] = values
    if (
      left < Number(windowBounds[1]) ||
      right > Number(windowBounds[3]) ||
      top < Number(windowBounds[2]) ||
      bottom > Number(windowBounds[4]) ||
      right - left < 44 ||
      bottom - top < 44
    )
      throw new Error(
        `${label} must fit the screen and retain a 44-point touch target: ${node.attributes.bounds}`,
      )
    let textNodes = 0
    function verifyLabel(child) {
      const attributes = child.attributes ?? {}
      if (attributes.text === label || attributes.accessibilityText === label) {
        const labelBounds = attributes.bounds
          ?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
          ?.slice(1)
          .map(Number)
        if (labelBounds) {
          textNodes++
          const [textLeft, textTop, textRight, textBottom] = labelBounds
          if (
            textLeft < left - 1 ||
            textTop < top - 1 ||
            textRight > right + 1 ||
            textBottom > bottom + 1
          )
            throw new Error(`${label}'s text extends outside its touch target at ${size}`)
        }
      }
      for (const descendant of child.children ?? []) verifyLabel(descendant)
    }
    for (const child of node.children ?? []) verifyLabel(child)
    return { label, left, top, right, bottom, textNodes }
  })
  for (const [index, first] of bounds.entries())
    for (const second of bounds.slice(index + 1))
      if (
        first.left < second.right &&
        second.left < first.right &&
        first.top < second.bottom &&
        second.top < first.bottom
      )
        throw new Error(
          `${first.label} and ${second.label} overlap instead of reserving their own space`,
        )
  // UIKit owns the header now; measure its accessible controls rather than an RN wrapper.
  const navigationActions = bounds.slice(0, 2)
  const navigationTop = Math.min(...navigationActions.map((action) => action.top))
  const navigationBottom = Math.max(...navigationActions.map((action) => action.bottom))
  const navigationHeader = {
    left: Math.min(...navigationActions.map((action) => action.left)),
    top: navigationTop,
    right: Math.max(...navigationActions.map((action) => action.right)),
    bottom: navigationBottom,
  }
  if (navigationBottom - navigationTop > (Number(windowBounds[4]) - Number(windowBounds[2])) / 2)
    throw new Error(`The PR navigation controls consume more than half the viewport at ${size}`)
  const headerNode = nodes.find(
    ({ attributes }) =>
      attributes.text === 'Fix first runtime' ||
      attributes.accessibilityText === 'Fix first runtime',
  )
  const headerValues = headerNode?.attributes.bounds
    ?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    ?.slice(1)
    .map(Number)
  if (!headerValues) throw new Error('Missing React Native PR header text bounds')
  const [headerLeft, headerTop, headerRight, headerBottom] = headerValues
  const headerText = { left: headerLeft, top: headerTop, right: headerRight, bottom: headerBottom }
  if (previous && headerBottom - headerTop <= previous.headerText.bottom - previous.headerText.top)
    throw new Error(
      `The React Native PR header retained its stale paragraph height after changing text size to ${size}`,
    )
  const artifactDirectory = resolve('work/verification')
  await mkdir(artifactDirectory, { recursive: true })
  await writeFile(
    join(artifactDirectory, `mobile-pr-actions-${size}.json`),
    JSON.stringify({ size, actions: bounds, navigationHeader, headerText, tree }, null, 2),
  )
  if (bounds.some((action) => action.textNodes === 0))
    console.log(
      `${size}: SwiftUI merges button labels into accessibility nodes; inspect the saved screenshot for glyph wrapping.`,
    )
  return { actions: bounds, headerText }
}
const hostname = process.env.DOVO_TEST_RUNTIME_HOST ?? '127.0.0.1'
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-pr-check-'))
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('base64url'),
  port: 0,
  host: hostname === '127.0.0.1' ? hostname : '::',
})
const detailRequests = []
const readDetail = runtime.services.pullCache.detail.bind(runtime.services.pullCache)
runtime.services.pullCache.detail = (cwd, number, force) => {
  detailRequests.push({ cwd, number })
  return readDetail(cwd, number, force)
}
const approve = setInterval(() => {
  for (const request of runtime.services.pairing.pending())
    if (request.name === 'Dovo simulator test') runtime.services.pairing.approve(request.id, true)
}, 250)
let runtimeClosed = false
const originalContentSize = execFileSync('xcrun', ['simctl', 'ui', device, 'content_size'], {
  encoding: 'utf8',
}).trim()
try {
  execFileSync('xcrun', ['simctl', 'ui', device, 'content_size', 'large'])
  // iOS native tabs expose labels through their Tab Bar, rather than React Native test IDs.
  const nativeTabSelectors = (flow) =>
    flow.replace(
      /^(\s*)id: Tab (.+)$/gm,
      (_match, indent, label) =>
        `${indent}text: ${label}\n${indent}childOf:\n${indent}  text: Tab Bar`,
    )
  for (const name of ['reset-computers', 'open-devices', 'open-settings'])
    await writeFile(
      join(directory, `${name}.yaml`),
      nativeTabSelectors(await readFile(`apps/mobile/maestro/${name}.yaml`, 'utf8')),
    )
  // Maestro's dimension selectors require literal numbers, unlike its text selectors.
  const flow = nativeTabSelectors(
    await readFile(
      `apps/mobile/maestro/${navigationOnly ? 'pulls-navigation' : 'pulls'}.yaml`,
      'utf8',
    ),
  ).replaceAll('${PR_ACTION_HALF_WIDTH}', String(halfContentWidth))
  const flowPath = join(directory, 'pulls.yaml')
  await writeFile(flowPath, flow)
  for (const name of ['first', 'second']) {
    await mkdir(join(directory, name))
    execFileSync('git', ['init', '-q'], { cwd: join(directory, name) })
  }
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: ['first', 'second'].map((name) => ({
      id: name,
      name: `developer-platform/${name}-runtime-and-remote-device-connections`,
      path: join(directory, name),
      branch: 'main',
    })),
    tasks: [],
    agents: [
      {
        id: 'offline-cache-fixture',
        name: 'Offline cache fixture',
        provider: 'codex',
        model: '',
        permission: 'ask',
        endpoint: '',
        instructions: navigationOnly ? '' : 'Large offline workspace fixture. '.repeat(270000),
      },
    ],
  }))
  runtime.services.commands.save({
    ...runtime.services.commands.get(),
    gh: resolve('scripts/fixtures/github.cjs'),
  })
  const child = spawn(
    'maestro',
    [
      '--device',
      device,
      'test',
      '-e',
      `RUNTIME_ADDRESS=http://${hostname}:${runtime.port}`,
      '-e',
      `PAIRING_CODE=${runtime.services.pairing.createCode().code}`,
      '-e',
      `PR_DIRECT_LINK=dovo://pulls/pr/${encodeURIComponent(`http://${hostname}:${runtime.port}`)}/first/119`,
      '-e',
      `PR_INVALID_LINK=dovo://pulls/pr/${encodeURIComponent(`http://${hostname}:${runtime.port}`)}/first/not-a-number`,
      flowPath,
    ],
    { stdio: 'inherit' },
  )
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (result !== 0) throw new Error(`Mobile PR verification failed (${result})`)
  if (navigationOnly) {
    if (detailRequests.some(({ number }) => number === 987654 || !Number.isSafeInteger(number)))
      throw new Error('A guarded PR route issued a detail request against the selected computer')
    await mkdir(resolve('work/verification'), { recursive: true })
    await writeFile(
      resolve('work/verification/mobile-pr-native-navigation.json'),
      JSON.stringify({ device, detailRequests, unknownHostRequests: 0 }, null, 2),
    )
    console.log(
      'Native PR Back and edge-swipe preserve list position, search, repository/draft/sort filters; cold direct links and invalid-number/unknown-host guards verified.',
    )
  } else {
    const normalBounds = await verifyActionBounds('standard')
    const contentSize = execFileSync('xcrun', ['simctl', 'ui', device, 'content_size'], {
      encoding: 'utf8',
    }).trim()
    try {
      for (const size of ['extra-extra-extra-large', 'accessibility-extra-extra-extra-large']) {
        execFileSync('xcrun', ['simctl', 'ui', device, 'content_size', size])
        const actualSize = execFileSync('xcrun', ['simctl', 'ui', device, 'content_size'], {
          encoding: 'utf8',
        }).trim()
        if (actualSize !== size)
          throw new Error(`Could not set Dynamic Type to ${size}: ${actualSize}`)
        const largeTextFlowPath = join(directory, `pulls-${size}.yaml`)
        await writeFile(
          largeTextFlowPath,
          (await readFile('apps/mobile/maestro/pulls-large-text.yaml', 'utf8')).replaceAll(
            '${PR_TEXT_SIZE}',
            size,
          ),
        )
        const largeText = spawn('maestro', ['--device', device, 'test', largeTextFlowPath], {
          stdio: 'inherit',
        })
        const largeTextResult = await new Promise((resolve, reject) => {
          largeText.once('error', reject)
          largeText.once('exit', resolve)
        })
        if (largeTextResult !== 0)
          throw new Error(
            `Mobile PR Dynamic Type verification failed at ${size} (${largeTextResult})`,
          )
        await verifyActionBounds(size, normalBounds)
      }
    } finally {
      execFileSync('xcrun', ['simctl', 'ui', device, 'content_size', contentSize])
    }
    // Cold-launch verification starts with a stopped client. Release any unread large
    // snapshot response before waiting for the HTTP server to drain its connections.
    execFileSync('xcrun', ['simctl', 'terminate', device, 'com.dovo.studio'])
    await runtime.close()
    runtimeClosed = true
    clearInterval(approve)
    const offlineFlowPath = join(directory, 'pulls-offline.yaml')
    await writeFile(
      offlineFlowPath,
      nativeTabSelectors(
        await readFile('apps/mobile/maestro/pulls-offline.yaml', 'utf8'),
      ).replaceAll('${PR_ACTION_HALF_WIDTH}', String(halfContentWidth)),
    )
    const offline = spawn('maestro', ['--device', device, 'test', offlineFlowPath], {
      stdio: 'inherit',
    })
    const offlineResult = await new Promise((resolve, reject) => {
      offline.once('error', reject)
      offline.once('exit', resolve)
    })
    if (offlineResult !== 0)
      throw new Error(`Mobile offline cache verification failed (${offlineResult})`)
    console.log(
      'Mobile PR status, rich Markdown, distinct review events, 44-point navigation controls at standard and large text sizes, native action menu, task sheet, checks, discussion, native diff, retained review progress and offline cold-launch cache verified.',
    )
  }
} finally {
  execFileSync('xcrun', ['simctl', 'ui', device, 'content_size', originalContentSize])
  clearInterval(approve)
  if (!runtimeClosed) await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
