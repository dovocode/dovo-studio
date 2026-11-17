import { automationSchema, type Automation } from '../workspace.js'
import { mutableStruct } from '../shared/schema.js'

export const automationRestoreDraftSchema = mutableStruct({
  definition: automationSchema,
  expected: automationSchema,
})

/** Keep current provider identity, connection and credential fields for matching steps. */
export function restorableAutomation(definition: Automation, current: Automation): Automation {
  return {
    ...definition,
    id: current.id,
    enabled: false,
    nodes: definition.nodes.map((node) => {
      if (!node.data.harness) return node
      const latest = current.nodes.find((item) => item.id === node.id)?.data.harness
      const {
        env: _env,
        envSecrets: _secrets,
        resources: _resources,
        endpoint: _endpoint,
        args: _args,
        configDirectory: _config,
        executablePath: _executable,
        ...harness
      } = node.data.harness
      return {
        ...node,
        data: {
          ...node.data,
          harness: {
            ...harness,
            provider: latest?.provider ?? harness.provider,
            model: latest && latest.provider !== harness.provider ? latest.model : harness.model,
            reasoning:
              latest && latest.provider !== harness.provider ? latest.reasoning : harness.reasoning,
            acpInstallationId: latest?.acpInstallationId,
            endpoint: latest?.endpoint ?? '',
            env: latest?.env,
            envSecrets: latest?.envSecrets,
            resources: latest?.resources,
            args: latest?.args,
            configDirectory: latest?.configDirectory,
            executablePath: latest?.executablePath,
          },
        },
      }
    }),
  }
}
