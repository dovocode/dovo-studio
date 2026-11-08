import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { expect, it } from 'vite-plus/test'
import * as protocol from '@dovo/protocol'
import * as agentToolsProtocol from '@dovo/protocol/agent-tools'
import * as clientRuntime from '@dovo/client-runtime'
import { terminalInputFrames } from '@dovo/client-runtime/terminal-input'

// Every provider turn spawns its own bridge process, so its import graph is paid per agent.
it('keeps the per-agent MCP bridge off the broad protocol and client-runtime barrels', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./server.ts', import.meta.url))],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    conditions: ['development'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'external-dependencies',
        setup(context) {
          context.onResolve({ filter: /^[^./]/ }, (args) =>
            args.path.startsWith('@dovo/') ? undefined : { path: args.path, external: true },
          )
        },
      },
    ],
  })
  const inputs = Object.keys(result.metafile.inputs)
  expect(inputs.some((input) => input.endsWith('agent-tools/server.ts'))).toBe(true)
  expect(
    inputs.filter((input) => /(protocol|client-runtime)\/src\/index\.ts$/.test(input)),
  ).toEqual([])
  const external = new Set(
    Object.values(result.metafile.outputs).flatMap((output) => output.imports.map((i) => i.path)),
  )
  for (const heavy of ['acorn', 'cron-parser', 'uuid', 'mdast-util-from-markdown', 'micromark'])
    expect([...external].filter((path) => path.startsWith(heavy))).toEqual([])
})

it('re-exports the same schema and terminal-input values as the full barrels', () => {
  const exported = Object.entries(agentToolsProtocol)
  expect(exported.length).toBeGreaterThan(0)
  expect(
    exported.filter(([name, value]) => Reflect.get(protocol, name) !== value).map(([name]) => name),
  ).toEqual([])
  expect(terminalInputFrames).toBe(clientRuntime.terminalInputFrames)
})
