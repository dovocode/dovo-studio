import { Schema } from 'effect'
import { mutableStruct, mutableArray, minValue, maxValue } from '../../shared/schema.js'
export const repositoryFolderSchema = mutableStruct({ path: minValue(Schema.String, 1) })
export const repositoryGitStatusSchema = mutableStruct({
  initialized: Schema.Boolean,
  remotes: mutableArray(Schema.String),
})
export const createGithubRepositorySchema = mutableStruct({
  ...repositoryFolderSchema.fields,
  name: maxValue(
    Schema.String.pipe(
      Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)?$/)),
    ),
    200,
  ),
  visibility: Schema.Literals(['private', 'public']),
})
export const jetbrainsOpenTargets = [
  ['webstorm', 'WebStorm'],
  ['idea', 'IntelliJ IDEA'],
  ['pycharm', 'PyCharm'],
  ['phpstorm', 'PhpStorm'],
  ['goland', 'GoLand'],
  ['rider', 'Rider'],
  ['clion', 'CLion'],
  ['rustrover', 'RustRover'],
  ['rubymine', 'RubyMine'],
  ['datagrip', 'DataGrip'],
  ['dataspell', 'DataSpell'],
] as const
export const folderOpenerSchema = Schema.Literals(['finder', 'explorer', 'file-manager'])
export const codeEditorOpenTargets = [
  ['vscode', 'VS Code'],
  ['vscode-insiders', 'VS Code Insiders'],
  ['vscodium', 'VSCodium'],
  ['cursor', 'Cursor'],
  ['antigravity', 'Antigravity'],
  ['devin', 'Devin Desktop'],
  ['windsurf', 'Windsurf'],
] as const
export const repositoryOpenTargetSchema = Schema.Literals([
  'finder',
  'explorer',
  'file-manager',
  ...codeEditorOpenTargets.map(([target]) => target),
  'zed',
  ...jetbrainsOpenTargets.map(([target]) => target),
])
export const openRepositorySchema = mutableStruct({ target: repositoryOpenTargetSchema })
export const repositoryOpenTargetsSchema = mutableStruct({
  // A newer runtime may discover editors this client does not yet support.
  targets: mutableArray(Schema.String),
})
export type RepositoryOpenTarget = typeof repositoryOpenTargetSchema.Type
export const isRepositoryOpenTarget = Schema.is(repositoryOpenTargetSchema)
export function repositoryOpenTargets(folderOpener: typeof folderOpenerSchema.Type = 'finder') {
  return [
    [
      folderOpener,
      folderOpener === 'explorer'
        ? 'File Explorer'
        : folderOpener === 'file-manager'
          ? 'File manager'
          : 'Finder',
    ],
    ...codeEditorOpenTargets,
    ['zed', 'Zed'],
    ...jetbrainsOpenTargets,
  ] as const
}

/** A validated path on its owning runtime; launch is always performed by the desktop client. */
export const repositoryLocationSchema = mutableStruct({
  path: minValue(Schema.String, 1),
  runtimeId: minValue(Schema.String, 1),
  sshAddress: Schema.optional(Schema.String),
  kind: Schema.Literals(['folder', 'file']),
})
export const clientRepositoryOpenSchema = mutableStruct({
  ...repositoryLocationSchema.fields,
  target: repositoryOpenTargetSchema,
})
export interface RepositoryOpenerBridge {
  list: () => Promise<{ targets: string[]; localRuntimeId: string | null }>
  open: (input: typeof clientRepositoryOpenSchema.Type) => Promise<void>
}
export const sshRepositoryOpenTargets: readonly RepositoryOpenTarget[] = [
  ...codeEditorOpenTargets.map(([target]) => target),
  'zed',
]
