import { decode, mcpServerSchema, type MemoryScope, type McpServer } from '@dovo/protocol'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

export function taskToolsServer(
  taskId: string,
  port: number,
  token: string,
  host: string,
  readOnly = false,
  artifactsEnabled = false,
  parentRunId?: string,
  pullRequestWatchingEnabled = false,
  pipelineWatchingEnabled = false,
  memoryScopes: MemoryScope[] = [],
  deviceHubEnabled = false,
): McpServer {
  const localHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  const urlHost = localHost.includes(':') ? `[${localHost}]` : localHost
  const adjacent = new URL('./server.js', import.meta.url)
  const script = existsSync(fileURLToPath(adjacent))
    ? adjacent
    : new URL('../../dist/agent-tools/server.js', import.meta.url)
  return decode(mcpServerSchema, {
    name: 'dovo_task',
    enabled: true,
    transport: 'stdio',
    command: process.execPath,
    args: [fileURLToPath(script)],
    envValues: {
      ELECTRON_RUN_AS_NODE: '1',
      DOVO_TASK_ID: taskId,
      ...(parentRunId ? { DOVO_TASK_RUN_ID: parentRunId } : {}),
      DOVO_TASK_URL: `http://${urlHost}:${port}`,
      DOVO_TASK_TOKEN: token,
      DOVO_TASK_READ_ONLY: readOnly ? '1' : '0',
      DOVO_TASK_MEMORY_SCOPES: JSON.stringify(memoryScopes),
      DOVO_TASK_DEVICE_HUB_ENABLED: deviceHubEnabled ? '1' : '0',
      DOVO_TASK_ARTIFACTS_ENABLED: artifactsEnabled ? '1' : '0',
      DOVO_TASK_PIPELINE_WATCHING_ENABLED: pipelineWatchingEnabled ? '1' : '0',
      DOVO_TASK_PR_WATCHING_ENABLED: pullRequestWatchingEnabled ? '1' : '0',
    },
  })
}
