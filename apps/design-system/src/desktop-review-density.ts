// Synthetic source snapshots for production Git review UI; patches are genuine unified diffs.
import { decode, fileSchema, filePreviewSchema } from '../../../packages/protocol/src'

export const denseGitFiles = [
  {
    path: 'packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.ts',
    before:
      "import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n\nexport type RuntimeTarget = {\n  id: string\n  name: string\n  address: string\n  connected: boolean\n}\n\nexport function runtimeTargets(\n  profiles: readonly RuntimeProfile[],\n  snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n): RuntimeTarget[] {\n  return profiles.map((profile) => {\n    const snapshot = snapshots.get(profile.id)\n    return {\n      id: profile.id,\n      name: profile.name,\n      address: profile.connection.address,\n      connected: snapshot !== undefined,\n    }\n  })\n}\n\nexport function preferredRuntime(\n  targets: readonly RuntimeTarget[],\n  selectedId: string | undefined,\n): RuntimeTarget | undefined {\n  return targets.find((target) => target.id === selectedId) ?? targets[0]\n}\n\nexport function runtimeDescription(target: RuntimeTarget): string {\n  const connection = target.connected ? 'Connected' : 'Offline'\n  return `${target.name} \u00b7 ${connection}`\n}\n\nexport function projectRuntimeLabel(\n  projectName: string,\n  target: RuntimeTarget | undefined,\n): string {\n  if (!target) return projectName\n  return `${projectName} \u00b7 ${target.name}`\n}\n",
    after:
      "import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n\nexport type RuntimeTarget = {\n  id: string\n  name: string\n  address: string\n  connected: boolean\n}\n\nexport function runtimeTargets(\n  profiles: readonly RuntimeProfile[],\n  snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n): RuntimeTarget[] {\n  return profiles.map((profile) => {\n    const snapshot = snapshots.get(profile.id)\n    return {\n      id: profile.id,\n      name: profile.name,\n      address: profile.connection.address,\n      connected: snapshot?.connected === true,\n    }\n  })\n}\n\nexport function preferredRuntime(\n  targets: readonly RuntimeTarget[],\n  selectedId: string | undefined,\n): RuntimeTarget | undefined {\n  const selected = targets.find((target) => target.id === selectedId)\n  if (selected) return selected\n  return targets.find((target) => target.connected) ?? targets[0]\n}\n\nexport function runtimeDescription(target: RuntimeTarget): string {\n  const connection = target.connected ? 'Connected' : 'Reconnect to continue'\n  return `${target.name} \u00b7 ${connection}`\n}\n\nexport function projectRuntimeLabel(\n  projectName: string,\n  target: RuntimeTarget | undefined,\n): string {\n  if (!target) return `${projectName} \u00b7 Choose a computer`\n  if (!target.connected) return `${projectName} \u00b7 ${target.name} \u00b7 Offline`\n  return `${projectName} \u00b7 ${target.name}`\n}\n",
    viewed: false,
    gitStatus: {
      index: 'modified',
      workingTree: 'modified',
    },
  },
  {
    path: 'packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.test.ts',
    before:
      "import { expect, test } from 'vitest'\nimport { preferredRuntime, projectRuntimeLabel } from './runtime-targets'\n\nconst connected = {\n  id: 'studio',\n  name: 'Mac Studio',\n  address: 'http://100.83.20.11:51464',\n  connected: true,\n}\nconst offline = {\n  id: 'laptop',\n  name: 'Travel laptop',\n  address: 'http://100.83.20.12:51464',\n  connected: false,\n}\n\ntest('retains an explicitly selected computer', () => {\n  expect(preferredRuntime([offline, connected], offline.id)).toBe(offline)\n})\n\ntest('keeps the project name in the runtime label', () => {\n  expect(projectRuntimeLabel('Client portal', connected)).toBe(\n    'Client portal \u00b7 Mac Studio',\n  )\n})\n",
    after:
      "import { expect, test } from 'vitest'\nimport { preferredRuntime, projectRuntimeLabel } from './runtime-targets'\n\nconst connected = {\n  id: 'studio',\n  name: 'Mac Studio',\n  address: 'http://100.83.20.11:51464',\n  connected: true,\n}\nconst offline = {\n  id: 'laptop',\n  name: 'Travel laptop',\n  address: 'http://100.83.20.12:51464',\n  connected: false,\n}\n\ntest('retains an explicitly selected computer', () => {\n  expect(preferredRuntime([offline, connected], offline.id)).toBe(offline)\n})\n\ntest('keeps the project name in the runtime label', () => {\n  expect(projectRuntimeLabel('Client portal', connected)).toBe(\n    'Client portal \u00b7 Mac Studio',\n  )\n})\n\ntest('prefers a connected computer when selection is missing', () => {\n  expect(preferredRuntime([offline, connected], undefined)).toBe(connected)\n})\n\ntest('describes an offline project target', () => {\n  expect(projectRuntimeLabel('Client portal', offline)).toBe(\n    'Client portal \u00b7 Travel laptop \u00b7 Offline',\n  )\n})\n",
    viewed: false,
    gitStatus: {
      index: 'unchanged',
      workingTree: 'modified',
    },
  },
  {
    path: 'docs/runtime-connections.md',
    before: '# Runtime connections\n\nChoose a computer before starting a thread.\n',
    after:
      '# Runtime connections\n\nChoose a computer before starting a thread.\n\nHTTP is supported for local networks and VPN connections.\n',
    viewed: false,
    gitStatus: {
      index: 'modified',
      workingTree: 'unchanged',
    },
  },
]

export const denseGitComparisons = {
  'packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.ts': {
    staged: {
      before: {
        kind: 'text',
        size: 1139,
        text: "import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n\nexport type RuntimeTarget = {\n  id: string\n  name: string\n  address: string\n  connected: boolean\n}\n\nexport function runtimeTargets(\n  profiles: readonly RuntimeProfile[],\n  snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n): RuntimeTarget[] {\n  return profiles.map((profile) => {\n    const snapshot = snapshots.get(profile.id)\n    return {\n      id: profile.id,\n      name: profile.name,\n      address: profile.connection.address,\n      connected: snapshot !== undefined,\n    }\n  })\n}\n\nexport function preferredRuntime(\n  targets: readonly RuntimeTarget[],\n  selectedId: string | undefined,\n): RuntimeTarget | undefined {\n  return targets.find((target) => target.id === selectedId) ?? targets[0]\n}\n\nexport function runtimeDescription(target: RuntimeTarget): string {\n  const connection = target.connected ? 'Connected' : 'Offline'\n  return `${target.name} \u00b7 ${connection}`\n}\n\nexport function projectRuntimeLabel(\n  projectName: string,\n  target: RuntimeTarget | undefined,\n): string {\n  if (!target) return projectName\n  return `${projectName} \u00b7 ${target.name}`\n}\n",
        truncated: false,
      },
      after: {
        kind: 'text',
        size: 1239,
        text: "import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n\nexport type RuntimeTarget = {\n  id: string\n  name: string\n  address: string\n  connected: boolean\n}\n\nexport function runtimeTargets(\n  profiles: readonly RuntimeProfile[],\n  snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n): RuntimeTarget[] {\n  return profiles.map((profile) => {\n    const snapshot = snapshots.get(profile.id)\n    return {\n      id: profile.id,\n      name: profile.name,\n      address: profile.connection.address,\n      connected: snapshot?.connected === true,\n    }\n  })\n}\n\nexport function preferredRuntime(\n  targets: readonly RuntimeTarget[],\n  selectedId: string | undefined,\n): RuntimeTarget | undefined {\n  const selected = targets.find((target) => target.id === selectedId)\n  if (selected) return selected\n  return targets.find((target) => target.connected) ?? targets[0]\n}\n\nexport function runtimeDescription(target: RuntimeTarget): string {\n  const connection = target.connected ? 'Connected' : 'Offline'\n  return `${target.name} \u00b7 ${connection}`\n}\n\nexport function projectRuntimeLabel(\n  projectName: string,\n  target: RuntimeTarget | undefined,\n): string {\n  if (!target) return projectName\n  return `${projectName} \u00b7 ${target.name}`\n}\n",
        truncated: false,
      },
      patch:
        "--- a/packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.ts\n+++ b/packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.ts\n@@ -1,43 +1,45 @@\n import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n \n export type RuntimeTarget = {\n   id: string\n   name: string\n   address: string\n   connected: boolean\n }\n \n export function runtimeTargets(\n   profiles: readonly RuntimeProfile[],\n   snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n ): RuntimeTarget[] {\n   return profiles.map((profile) => {\n     const snapshot = snapshots.get(profile.id)\n     return {\n       id: profile.id,\n       name: profile.name,\n       address: profile.connection.address,\n-      connected: snapshot !== undefined,\n+      connected: snapshot?.connected === true,\n     }\n   })\n }\n \n export function preferredRuntime(\n   targets: readonly RuntimeTarget[],\n   selectedId: string | undefined,\n ): RuntimeTarget | undefined {\n-  return targets.find((target) => target.id === selectedId) ?? targets[0]\n+  const selected = targets.find((target) => target.id === selectedId)\n+  if (selected) return selected\n+  return targets.find((target) => target.connected) ?? targets[0]\n }\n \n export function runtimeDescription(target: RuntimeTarget): string {\n   const connection = target.connected ? 'Connected' : 'Offline'\n   return `${target.name} \u00b7 ${connection}`\n }\n \n export function projectRuntimeLabel(\n   projectName: string,\n   target: RuntimeTarget | undefined,\n ): string {\n   if (!target) return projectName\n   return `${projectName} \u00b7 ${target.name}`\n }\n",
    },
    unstaged: {
      before: {
        kind: 'text',
        size: 1239,
        text: "import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n\nexport type RuntimeTarget = {\n  id: string\n  name: string\n  address: string\n  connected: boolean\n}\n\nexport function runtimeTargets(\n  profiles: readonly RuntimeProfile[],\n  snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n): RuntimeTarget[] {\n  return profiles.map((profile) => {\n    const snapshot = snapshots.get(profile.id)\n    return {\n      id: profile.id,\n      name: profile.name,\n      address: profile.connection.address,\n      connected: snapshot?.connected === true,\n    }\n  })\n}\n\nexport function preferredRuntime(\n  targets: readonly RuntimeTarget[],\n  selectedId: string | undefined,\n): RuntimeTarget | undefined {\n  const selected = targets.find((target) => target.id === selectedId)\n  if (selected) return selected\n  return targets.find((target) => target.connected) ?? targets[0]\n}\n\nexport function runtimeDescription(target: RuntimeTarget): string {\n  const connection = target.connected ? 'Connected' : 'Offline'\n  return `${target.name} \u00b7 ${connection}`\n}\n\nexport function projectRuntimeLabel(\n  projectName: string,\n  target: RuntimeTarget | undefined,\n): string {\n  if (!target) return projectName\n  return `${projectName} \u00b7 ${target.name}`\n}\n",
        truncated: false,
      },
      after: {
        kind: 'text',
        size: 1357,
        text: "import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n\nexport type RuntimeTarget = {\n  id: string\n  name: string\n  address: string\n  connected: boolean\n}\n\nexport function runtimeTargets(\n  profiles: readonly RuntimeProfile[],\n  snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n): RuntimeTarget[] {\n  return profiles.map((profile) => {\n    const snapshot = snapshots.get(profile.id)\n    return {\n      id: profile.id,\n      name: profile.name,\n      address: profile.connection.address,\n      connected: snapshot?.connected === true,\n    }\n  })\n}\n\nexport function preferredRuntime(\n  targets: readonly RuntimeTarget[],\n  selectedId: string | undefined,\n): RuntimeTarget | undefined {\n  const selected = targets.find((target) => target.id === selectedId)\n  if (selected) return selected\n  return targets.find((target) => target.connected) ?? targets[0]\n}\n\nexport function runtimeDescription(target: RuntimeTarget): string {\n  const connection = target.connected ? 'Connected' : 'Reconnect to continue'\n  return `${target.name} \u00b7 ${connection}`\n}\n\nexport function projectRuntimeLabel(\n  projectName: string,\n  target: RuntimeTarget | undefined,\n): string {\n  if (!target) return `${projectName} \u00b7 Choose a computer`\n  if (!target.connected) return `${projectName} \u00b7 ${target.name} \u00b7 Offline`\n  return `${projectName} \u00b7 ${target.name}`\n}\n",
        truncated: false,
      },
      patch:
        "--- a/packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.ts\n+++ b/packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.ts\n@@ -1,45 +1,46 @@\n import type { RuntimeProfile, RuntimeSnapshot } from '../runtime/types'\n \n export type RuntimeTarget = {\n   id: string\n   name: string\n   address: string\n   connected: boolean\n }\n \n export function runtimeTargets(\n   profiles: readonly RuntimeProfile[],\n   snapshots: ReadonlyMap<string, RuntimeSnapshot>,\n ): RuntimeTarget[] {\n   return profiles.map((profile) => {\n     const snapshot = snapshots.get(profile.id)\n     return {\n       id: profile.id,\n       name: profile.name,\n       address: profile.connection.address,\n       connected: snapshot?.connected === true,\n     }\n   })\n }\n \n export function preferredRuntime(\n   targets: readonly RuntimeTarget[],\n   selectedId: string | undefined,\n ): RuntimeTarget | undefined {\n   const selected = targets.find((target) => target.id === selectedId)\n   if (selected) return selected\n   return targets.find((target) => target.connected) ?? targets[0]\n }\n \n export function runtimeDescription(target: RuntimeTarget): string {\n-  const connection = target.connected ? 'Connected' : 'Offline'\n+  const connection = target.connected ? 'Connected' : 'Reconnect to continue'\n   return `${target.name} \u00b7 ${connection}`\n }\n \n export function projectRuntimeLabel(\n   projectName: string,\n   target: RuntimeTarget | undefined,\n ): string {\n-  if (!target) return projectName\n+  if (!target) return `${projectName} \u00b7 Choose a computer`\n+  if (!target.connected) return `${projectName} \u00b7 ${target.name} \u00b7 Offline`\n   return `${projectName} \u00b7 ${target.name}`\n }\n",
    },
  },
  'packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.test.ts': {
    staged: {
      before: {
        kind: 'text',
        size: 655,
        text: "import { expect, test } from 'vitest'\nimport { preferredRuntime, projectRuntimeLabel } from './runtime-targets'\n\nconst connected = {\n  id: 'studio',\n  name: 'Mac Studio',\n  address: 'http://100.83.20.11:51464',\n  connected: true,\n}\nconst offline = {\n  id: 'laptop',\n  name: 'Travel laptop',\n  address: 'http://100.83.20.12:51464',\n  connected: false,\n}\n\ntest('retains an explicitly selected computer', () => {\n  expect(preferredRuntime([offline, connected], offline.id)).toBe(offline)\n})\n\ntest('keeps the project name in the runtime label', () => {\n  expect(projectRuntimeLabel('Client portal', connected)).toBe(\n    'Client portal \u00b7 Mac Studio',\n  )\n})\n",
        truncated: false,
      },
      after: {
        kind: 'text',
        size: 655,
        text: "import { expect, test } from 'vitest'\nimport { preferredRuntime, projectRuntimeLabel } from './runtime-targets'\n\nconst connected = {\n  id: 'studio',\n  name: 'Mac Studio',\n  address: 'http://100.83.20.11:51464',\n  connected: true,\n}\nconst offline = {\n  id: 'laptop',\n  name: 'Travel laptop',\n  address: 'http://100.83.20.12:51464',\n  connected: false,\n}\n\ntest('retains an explicitly selected computer', () => {\n  expect(preferredRuntime([offline, connected], offline.id)).toBe(offline)\n})\n\ntest('keeps the project name in the runtime label', () => {\n  expect(projectRuntimeLabel('Client portal', connected)).toBe(\n    'Client portal \u00b7 Mac Studio',\n  )\n})\n",
        truncated: false,
      },
      patch: '',
    },
    unstaged: {
      before: {
        kind: 'text',
        size: 655,
        text: "import { expect, test } from 'vitest'\nimport { preferredRuntime, projectRuntimeLabel } from './runtime-targets'\n\nconst connected = {\n  id: 'studio',\n  name: 'Mac Studio',\n  address: 'http://100.83.20.11:51464',\n  connected: true,\n}\nconst offline = {\n  id: 'laptop',\n  name: 'Travel laptop',\n  address: 'http://100.83.20.12:51464',\n  connected: false,\n}\n\ntest('retains an explicitly selected computer', () => {\n  expect(preferredRuntime([offline, connected], offline.id)).toBe(offline)\n})\n\ntest('keeps the project name in the runtime label', () => {\n  expect(projectRuntimeLabel('Client portal', connected)).toBe(\n    'Client portal \u00b7 Mac Studio',\n  )\n})\n",
        truncated: false,
      },
      after: {
        kind: 'text',
        size: 977,
        text: "import { expect, test } from 'vitest'\nimport { preferredRuntime, projectRuntimeLabel } from './runtime-targets'\n\nconst connected = {\n  id: 'studio',\n  name: 'Mac Studio',\n  address: 'http://100.83.20.11:51464',\n  connected: true,\n}\nconst offline = {\n  id: 'laptop',\n  name: 'Travel laptop',\n  address: 'http://100.83.20.12:51464',\n  connected: false,\n}\n\ntest('retains an explicitly selected computer', () => {\n  expect(preferredRuntime([offline, connected], offline.id)).toBe(offline)\n})\n\ntest('keeps the project name in the runtime label', () => {\n  expect(projectRuntimeLabel('Client portal', connected)).toBe(\n    'Client portal \u00b7 Mac Studio',\n  )\n})\n\ntest('prefers a connected computer when selection is missing', () => {\n  expect(preferredRuntime([offline, connected], undefined)).toBe(connected)\n})\n\ntest('describes an offline project target', () => {\n  expect(projectRuntimeLabel('Client portal', offline)).toBe(\n    'Client portal \u00b7 Travel laptop \u00b7 Offline',\n  )\n})\n",
        truncated: false,
      },
      patch:
        "--- a/packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.test.ts\n+++ b/packages/studio-core/src/runtime/navigation/project-runtime-selection/runtime-targets.test.ts\n@@ -1,25 +1,35 @@\n import { expect, test } from 'vitest'\n import { preferredRuntime, projectRuntimeLabel } from './runtime-targets'\n \n const connected = {\n   id: 'studio',\n   name: 'Mac Studio',\n   address: 'http://100.83.20.11:51464',\n   connected: true,\n }\n const offline = {\n   id: 'laptop',\n   name: 'Travel laptop',\n   address: 'http://100.83.20.12:51464',\n   connected: false,\n }\n \n test('retains an explicitly selected computer', () => {\n   expect(preferredRuntime([offline, connected], offline.id)).toBe(offline)\n })\n \n test('keeps the project name in the runtime label', () => {\n   expect(projectRuntimeLabel('Client portal', connected)).toBe(\n     'Client portal \u00b7 Mac Studio',\n   )\n })\n+\n+test('prefers a connected computer when selection is missing', () => {\n+  expect(preferredRuntime([offline, connected], undefined)).toBe(connected)\n+})\n+\n+test('describes an offline project target', () => {\n+  expect(projectRuntimeLabel('Client portal', offline)).toBe(\n+    'Client portal \u00b7 Travel laptop \u00b7 Offline',\n+  )\n+})\n",
    },
  },
  'docs/runtime-connections.md': {
    staged: {
      before: {
        kind: 'text',
        size: 67,
        text: '# Runtime connections\n\nChoose a computer before starting a thread.\n',
        truncated: false,
      },
      after: {
        kind: 'text',
        size: 126,
        text: '# Runtime connections\n\nChoose a computer before starting a thread.\n\nHTTP is supported for local networks and VPN connections.\n',
        truncated: false,
      },
      patch:
        '--- a/docs/runtime-connections.md\n+++ b/docs/runtime-connections.md\n@@ -1,3 +1,5 @@\n # Runtime connections\n \n Choose a computer before starting a thread.\n+\n+HTTP is supported for local networks and VPN connections.\n',
    },
    unstaged: {
      before: {
        kind: 'text',
        size: 126,
        text: '# Runtime connections\n\nChoose a computer before starting a thread.\n\nHTTP is supported for local networks and VPN connections.\n',
        truncated: false,
      },
      after: {
        kind: 'text',
        size: 126,
        text: '# Runtime connections\n\nChoose a computer before starting a thread.\n\nHTTP is supported for local networks and VPN connections.\n',
        truncated: false,
      },
      patch: '',
    },
  },
}

// Validate fixture shape at the same boundary used by live runtime reads.
for (const file of denseGitFiles) decode(fileSchema, file)
for (const comparisons of Object.values(denseGitComparisons))
  for (const preview of Object.values(comparisons)) decode(filePreviewSchema, preview)
