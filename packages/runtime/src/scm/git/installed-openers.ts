import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import { Schema } from 'effect'
import { decode, jetbrainsOpenTargets, type RepositoryOpenTarget } from '@dovo/protocol'
import { exec, processEnvironment, ProcessError } from '../../process.js'
import { parse } from 'shell-quote'

// Keep Windows paths explicit even while inspecting them from WSL.
const pathAPI = (path: string) => (/^[A-Za-z]:[\\/]|^\\\\/.test(path) ? win32 : posix)
const join = (root: string, ...parts: string[]) => pathAPI(root).join(root, ...parts)
const basename = (path: string) => pathAPI(path).basename(path)
const resolve = (root: string, path: string) => pathAPI(root).resolve(root, path)
const relative = (root: string, path: string) => pathAPI(root).relative(root, path)
export type InstalledOpener = {
  target: RepositoryOpenTarget
  executable: string
  prefix: string[]
  kind: 'app' | 'native' | 'wsl-windows'
}
type EditorTarget = Exclude<RepositoryOpenTarget, 'finder' | 'explorer' | 'file-manager'>
type Editor = {
  target: EditorTarget
  cli: string[]
  mac: string[]
  bundle: string[]
  binaries: string[]
  directories: string[]
  flatpak: string[]
}
const productCodes: Record<string, EditorTarget> = {
  WS: 'webstorm',
  IU: 'idea',
  IC: 'idea',
  PY: 'pycharm',
  PC: 'pycharm',
  PS: 'phpstorm',
  GO: 'goland',
  RD: 'rider',
  CL: 'clion',
  RR: 'rustrover',
  RM: 'rubymine',
  DG: 'datagrip',
  DS: 'dataspell',
}
const editors: Editor[] = [
  {
    target: 'vscode',
    cli: ['code'],
    mac: ['Visual Studio Code'],
    bundle: ['com.microsoft.VSCode'],
    binaries: ['Code.exe'],
    directories: ['Microsoft VS Code'],
    flatpak: ['com.visualstudio.code'],
  },
  {
    target: 'vscode-insiders',
    cli: ['code-insiders'],
    mac: ['Visual Studio Code - Insiders'],
    bundle: ['com.microsoft.VSCodeInsiders'],
    binaries: ['Code - Insiders.exe'],
    directories: ['Microsoft VS Code Insiders'],
    flatpak: [],
  },
  {
    target: 'vscodium',
    cli: ['codium', 'codium-insiders'],
    mac: ['VSCodium', 'VSCodium - Insiders'],
    bundle: ['com.vscodium', 'com.vscodium.VSCodium', 'com.vscodium.VSCodiumInsiders'],
    binaries: ['VSCodium.exe', 'VSCodium - Insiders.exe'],
    directories: ['VSCodium', 'VSCodium Insiders', 'VSCodium - Insiders'],
    flatpak: ['com.vscodium.codium'],
  },
  {
    target: 'cursor',
    cli: ['cursor'],
    mac: ['Cursor'],
    bundle: ['com.todesktop.230313mzl4w4u92'],
    binaries: ['Cursor.exe'],
    directories: ['cursor', 'Cursor'],
    flatpak: [],
  },
  {
    target: 'antigravity',
    cli: ['antigravity', 'antigravity-ide'],
    mac: ['Antigravity IDE', 'Antigravity'],
    bundle: ['com.google.antigravity', 'com.google.antigravity.ide'],
    binaries: ['Antigravity IDE.exe', 'Antigravity.exe'],
    directories: ['Antigravity IDE', 'Antigravity'],
    flatpak: [],
  },
  {
    target: 'devin',
    // `devin` is the agent CLI, not the desktop folder opener.
    cli: ['devin-desktop', 'devin-desktop-next'],
    mac: ['Devin', 'Devin Next', 'Devin Desktop'],
    bundle: ['com.exafunction.devin', 'com.exafunction.devin-next'],
    binaries: ['Devin.exe', 'Devin - Next.exe', 'Devin Next.exe'],
    directories: ['Devin', 'Devin Next', 'Windsurf', 'Windsurf Next'],
    flatpak: [],
  },
  {
    target: 'windsurf',
    cli: ['windsurf', 'windsurf-next', 'surf'],
    mac: ['Windsurf', 'Windsurf Next'],
    bundle: ['com.exafunction.windsurf', 'com.exafunction.windsurf-next'],
    binaries: ['Windsurf.exe', 'Windsurf - Next.exe', 'Windsurf Next.exe'],
    directories: ['Windsurf', 'Windsurf Next'],
    flatpak: [],
  },
  {
    target: 'zed',
    cli: ['zeditor', 'zed'],
    mac: ['Zed', 'Zed Preview'],
    bundle: ['dev.zed.Zed', 'dev.zed.Zed-Preview'],
    binaries: ['Zed.exe'],
    directories: ['Zed', 'Zed Preview'],
    flatpak: ['dev.zed.Zed'],
  },
  ...jetbrainsOpenTargets.map(([target, name]): Editor => ({
    target,
    cli: [
      target,
      `${target}.sh`,
      ...(target === 'idea'
        ? ['idea-community', 'intellij-idea-ultimate', 'intellij-idea-community']
        : target === 'pycharm'
          ? ['pycharm-professional', 'pycharm-community']
          : []),
    ],
    mac: [
      name,
      ...(target === 'idea'
        ? ['IntelliJ IDEA CE', 'IntelliJ IDEA Ultimate']
        : target === 'pycharm'
          ? ['PyCharm CE', 'PyCharm Professional Edition']
          : []),
    ],
    bundle: [
      `com.jetbrains.${target === 'idea' ? 'intellij' : target}`,
      `com.jetbrains.${name}`,
      ...(target === 'idea'
        ? ['com.jetbrains.intellij.ce']
        : target === 'pycharm'
          ? ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce']
          : []),
    ],
    binaries: [`${target}64.exe`, `${target}.exe`],
    directories: [name],
    flatpak: [
      `com.jetbrains.${target === 'idea' ? 'IntelliJ-IDEA-Ultimate' : name}`,
      ...(target === 'idea'
        ? ['com.jetbrains.IntelliJ-IDEA-Community']
        : target === 'pycharm'
          ? ['com.jetbrains.PyCharm-Community', 'com.jetbrains.PyCharm-Professional']
          : []),
    ],
  })),
]
const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
async function existingFile(path: string) {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (missing(error)) return false
    throw error
  }
}
async function executable(path: string) {
  if (!(await existingFile(path))) return false
  if (process.platform === 'win32') return true
  try {
    await access(path, constants.X_OK)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EACCES') return false
    throw error
  }
}
async function directories(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(path, entry.name))
  } catch (error) {
    if (missing(error)) return []
    throw error
  }
}
async function optionalJSON(path: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}
async function* commandsOnPath(names: readonly string[], extra: string[] = []) {
  for (const name of names)
    for (const directory of [...(process.env.PATH ?? '').split(':').filter(Boolean), ...extra]) {
      const path = join(directory, name)
      // Linux also ships an unrelated ZFS event daemon named zed in sbin.
      if (name === 'zed' && /\/sbin\/zed$/.test(path)) continue
      if (await executable(path)) yield path
    }
}
async function commandOnPath(names: readonly string[], extra: string[] = []) {
  for await (const path of commandsOnPath(names, extra)) return path
  return undefined
}
const productInfoSchema = Schema.Struct({
  productCode: Schema.String,
  launch: Schema.Array(
    Schema.Struct({
      os: Schema.String,
      arch: Schema.optional(Schema.String),
      launcherPath: Schema.String,
    }),
  ),
})
const toolboxSettingsSchema = Schema.Struct({
  install_location: Schema.optional(Schema.NullOr(Schema.String)),
  installLocation: Schema.optional(Schema.NullOr(Schema.String)),
})
const codeProductSchema = Schema.Struct({
  nameShort: Schema.optional(Schema.String),
  nameLong: Schema.optional(Schema.String),
  applicationName: Schema.optional(Schema.String),
})
async function codeProduct(path: string) {
  const actual = await realpath(path)
  const parent = pathAPI(actual).dirname(actual)
  for (const root of [actual, parent, pathAPI(parent).dirname(parent)]) {
    for (const product of ['resources/app/product.json', 'Contents/Resources/app/product.json']) {
      const raw = await optionalJSON(join(root, product))
      if (raw !== undefined) return decode(codeProductSchema, raw)
    }
  }
  return undefined
}
const windowsInfoSchema = Schema.Struct({
  local: Schema.String,
  programs: Schema.String,
  programsX86: Schema.String,
  root: Schema.String,
  home: Schema.String,
  roots: Schema.Array(Schema.String),
  binaries: Schema.Array(Schema.String),
  commands: Schema.Array(Schema.String),
})
// One read-only query covers per-user/all-user and custom registered installations.
const windowsInfoScript = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);
$commands=@();foreach($name in @(${editors
  .flatMap((editor) => editor.cli)
  .filter((name) => !name.endsWith('.sh'))
  .map((name) => "'" + name + "'")
  .join(
    ',',
  )})){Get-Command $name -CommandType Application -All -ErrorAction SilentlyContinue | ForEach-Object {$commands+=[string]$_.Source}};
$roots=@();$bins=@();
foreach($root in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')) {
 if(Test-Path $root) { Get-ChildItem $root | ForEach-Object { $app=Get-ItemProperty $_.PSPath; if($app.DisplayName -match 'Visual Studio Code|VSCodium|Cursor|Antigravity|Devin|Windsurf|Zed|JetBrains|IntelliJ|PyCharm|WebStorm|PhpStorm|GoLand|Rider|CLion|RustRover|RubyMine|DataGrip|DataSpell') { if($app.InstallLocation){$roots+=[string]$app.InstallLocation}; if($app.DisplayIcon){$bins+=([string]$app.DisplayIcon -replace ',\\s*-?\\d+$','').Trim('"')} } } }
}
foreach($root in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths')) {
 foreach($name in @(${editors
   .flatMap((editor) => editor.binaries)
   .map((name) => "'" + name + "'")
   .join(
     ',',
   )})) { $key=Join-Path $root $name; if(Test-Path $key){$value=(Get-Item $key).GetValue('');if($value){$bins+=[string]$value}} }
}
[ordered]@{local=[string]$env:LOCALAPPDATA;programs=[string]$env:ProgramFiles;programsX86=[string]\${env:ProgramFiles(x86)};root=[string]$env:SystemRoot;home=[string]$env:USERPROFILE;roots=@($roots);binaries=@($bins);commands=@($commands)} | ConvertTo-Json -Compress`

export async function detectInstalledOpeners() {
  const found = new Map<RepositoryOpenTarget, InstalledOpener>()
  const add = (
    target: RepositoryOpenTarget,
    path: string,
    kind: InstalledOpener['kind'] = 'native',
    prefix: string[] = [],
  ) => {
    if (!found.has(target)) found.set(target, { target, executable: path, prefix, kind })
  }
  const addEditor = async (
    target: EditorTarget,
    path: string,
    kind: InstalledOpener['kind'] = 'native',
    prefix: string[] = [],
    productPath = path,
  ) => {
    if (target === 'devin' || target === 'windsurf' || target === 'antigravity') {
      const product = await codeProduct(productPath)
      const name = product
        ? [product.nameShort, product.nameLong, product.applicationName].join(' ')
        : ''
      if (target === 'devin' && !/devin|windsurf/i.test(name)) return false
      if (target === 'antigravity' && !/antigravity/i.test(name)) return false
      if (target === 'windsurf' && product && /devin/i.test(name)) target = 'devin'
    }
    add(target, path, kind, prefix)
    return true
  }
  const home = homedir()
  if (process.platform === 'darwin') {
    if (await executable('/usr/bin/open')) add('finder', '/usr/bin/open')
    const apps = (
      await Promise.all(['/Applications', join(home, 'Applications')].map(directories))
    ).flat()
    const spotlight = await executable('/usr/bin/mdfind')
    await Promise.all(
      editors.map(async (editor) => {
        for (const app of apps.filter((path) =>
          editor.mac.some((name) => basename(path).toLowerCase() === `${name}.app`.toLowerCase()),
        )) {
          if (await macAppExists(app)) {
            if (await addEditor(editor.target, app, 'app')) return
          }
        }
        if (spotlight) {
          const query = editor.bundle
            .map((id) => `kMDItemCFBundleIdentifier == "${id}"`)
            .join(' || ')
          const result = await exec('/usr/bin/mdfind', [query], {
            timeout: 5000,
            env: processEnvironment(),
            maxBuffer: 1024 * 1024,
          })
          for (const path of result.stdout.split('\n').filter((path) => path.endsWith('.app'))) {
            try {
              if ((await stat(path)).isDirectory() && (await macAppExists(path))) {
                if (await addEditor(editor.target, path, 'app')) return
              }
            } catch (error) {
              if (!missing(error)) throw error
            }
          }
        }
        // Homebrew/custom installations can be outside Spotlight's indexed directories.
        for await (const cli of commandsOnPath(editor.cli, [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          join(home, '.local/bin'),
        ]))
          if (!cli.includes('/JetBrains/Toolbox/scripts/') && (await addEditor(editor.target, cli)))
            return
      }),
    )
    return [...found.values()]
  }
  if (process.platform !== 'win32' && process.platform !== 'linux') return []
  const wsl = process.platform === 'linux' && !!process.env.WSL_DISTRO_NAME
  if (process.platform === 'linux') {
    const extras = [
      join(home, '.local', 'bin'),
      '/snap/bin',
      join(home, '.codeium/windsurf/bin'),
      join(home, '.local/share/JetBrains/Toolbox/scripts'),
    ]
    if (wsl) {
      const folder = await commandOnPath(['explorer.exe'])
      if (folder) add('explorer', folder)
    } else {
      const folder = await linuxFolderOpener()
      if (folder) add('file-manager', folder.executable, 'native', folder.prefix)
    }
    for (const editor of editors) {
      for await (const cli of commandsOnPath(editor.cli, extras))
        if (!cli.includes('/JetBrains/Toolbox/scripts/') && (await addEditor(editor.target, cli)))
          break
    }
    const flatpak = await commandOnPath(['flatpak'])
    if (flatpak) {
      const list = await exec(flatpak, ['list', '--app', '--columns=application'], {
        timeout: 5000,
        env: processEnvironment(),
        maxBuffer: 1024 * 1024,
      })
      const ids = new Set(list.stdout.trim().split(/\s+/))
      for (const editor of editors) {
        const id = editor.flatpak.find((id) => ids.has(id))
        if (id) add(editor.target, flatpak, 'native', ['run', id])
      }
    }
  }
  // Product metadata is authoritative across versioned manual and Toolbox installations.
  const scan = async (
    root: string,
    depth: number,
    os: 'Linux' | 'Windows',
    kind: InstalledOpener['kind'],
  ) => {
    const raw = await optionalJSON(join(root, 'product-info.json'))
    if (raw !== undefined) {
      const product = decode(productInfoSchema, raw)
      const target = productCodes[product.productCode]
      if (!target) return
      const launches = product.launch.filter((launch) => launch.os === os)
      const arch = process.arch === 'arm64' ? ['aarch64', 'arm64'] : ['amd64', 'x86_64', 'x64']
      launches.sort(
        (a, b) =>
          Number(!!b.arch && arch.includes(b.arch)) - Number(!!a.arch && arch.includes(a.arch)),
      )
      for (const launch of launches) {
        const path = resolve(root, launch.launcherPath)
        if (relative(root, path).startsWith('..')) continue
        if (await executable(path)) {
          add(target, path, kind)
          break
        }
      }
      return
    }
    if (depth) for (const child of await directories(root)) await scan(child, depth - 1, os, kind)
  }
  const toolboxRoots = (base: string) => [join(base, '.settings.json'), join(base, 'settings.json')]
  const scanToolbox = async (
    base: string,
    os: 'Linux' | 'Windows',
    kind: InstalledOpener['kind'],
    convert: (path: string) => Promise<string> = async (path) => path,
  ) => {
    await scan(join(base, 'apps'), 4, os, kind)
    for (const settings of toolboxRoots(base)) {
      const raw = await optionalJSON(settings)
      if (raw === undefined) continue
      const value = decode(toolboxSettingsSchema, raw)
      const root = value.install_location || value.installLocation
      if (root) await scan(await convert(root), 4, os, kind)
    }
  }
  if (process.platform === 'linux') {
    await scanToolbox(join(home, '.local/share/JetBrains/Toolbox'), 'Linux', 'native')
    for (const parent of ['/opt', '/opt/jetbrains', join(home, 'Applications')]) {
      for (const root of await directories(parent))
        if (
          /idea|intellij|pycharm|webstorm|phpstorm|goland|rider|clion|rustrover|rubymine|datagrip|dataspell/i.test(
            basename(root),
          )
        )
          await scan(root, 1, 'Linux', 'native')
    }
    await detectDesktopEntries(found, addEditor)
  }
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const powershell =
    process.platform === 'win32'
      ? win32.join(windowsRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
      : wsl
        ? await commandOnPath(['powershell.exe'])
        : undefined
  if (process.platform !== 'win32' && !powershell) return [...found.values()]
  const fallback = {
    local: process.env.LOCALAPPDATA || win32.join(home, 'AppData/Local'),
    programs: process.env.ProgramFiles || '',
    programsX86: process.env['ProgramFiles(x86)'] || '',
    root: windowsRoot,
    home,
    roots: [],
    binaries: [],
    commands: [],
  }
  let info: typeof windowsInfoSchema.Type = fallback
  if (powershell && (await executable(powershell))) {
    const result = await exec(
      powershell,
      ['-NoProfile', '-NonInteractive', '-Command', windowsInfoScript],
      { timeout: 10000, env: processEnvironment(), maxBuffer: 1024 * 1024 },
    )
    info = decode(windowsInfoSchema, JSON.parse(result.stdout.trim()))
  }
  const convertedVolumes = new Map<string, Promise<string>>()
  const convert = async (path: string) => {
    if (!wsl) return path
    const root = win32.parse(path).root
    let converted = convertedVolumes.get(root)
    if (!converted) {
      converted = exec('wslpath', ['-u', root], { timeout: 5000, env: processEnvironment() }).then(
        (result) => {
          const path = result.stdout.trim()
          if (!posix.isAbsolute(path))
            throw new Error(`Could not locate Windows volume ${root} in WSL`)
          return path
        },
      )
      convertedVolumes.set(root, converted)
    }
    return posix.join(await converted, ...win32.relative(root, path).split('\\'))
  }
  const kind = wsl ? 'wsl-windows' : 'native'
  const explorer = await convert(win32.join(info.root, 'explorer.exe'))
  if (await executable(explorer)) add('explorer', explorer, kind)
  const commandPaths = [...info.commands]
  const where = await convert(win32.join(info.root, 'System32/where.exe'))
  if ((!powershell || !(await executable(powershell))) && (await executable(where))) {
    try {
      const result = await exec(
        where,
        editors.flatMap((editor) =>
          editor.cli.filter((name) => !name.endsWith('.sh')).map((name) => `$PATH:${name}`),
        ),
        { timeout: 5000, env: processEnvironment(), maxBuffer: 1024 * 1024 },
      )
      commandPaths.push(
        ...result.stdout
          .split(/\r?\n/)
          .map((path) => path.trim())
          .filter(Boolean),
      )
    } catch (error) {
      if (!(error instanceof ProcessError && error.code === 1)) throw error
    }
  }
  for (const path of commandPaths) {
    const editor = editors.find((editor) =>
      editor.cli.some(
        (cli) =>
          win32
            .basename(path)
            .toLowerCase()
            .replace(/\.(exe|cmd|bat)$/i, '') === cli.toLowerCase(),
      ),
    )
    if (!editor) continue
    const candidates = /\.exe$/i.test(path)
      ? [path]
      : editor.binaries.flatMap((binary) => [
          win32.join(win32.dirname(path), binary),
          win32.resolve(win32.dirname(path), '..', binary),
        ])
    for (const candidate of candidates) {
      const native = await convert(candidate)
      if ((await executable(native)) && (await addEditor(editor.target, native, kind))) break
    }
  }
  for (const editor of editors) {
    if (found.has(editor.target)) continue
    const candidates = info.binaries.filter((path) =>
      editor.binaries.some((binary) => win32.basename(path).toLowerCase() === binary.toLowerCase()),
    )
    for (const root of [
      win32.join(info.local, 'Programs'),
      info.local,
      info.programs,
      info.programsX86,
      ...info.roots,
    ].filter(Boolean)) {
      for (const directory of ['', ...editor.directories])
        for (const binary of editor.binaries) candidates.push(win32.join(root, directory, binary))
    }
    for (const candidate of candidates) {
      const path = await convert(candidate)
      if ((await executable(path)) && (await addEditor(editor.target, path, kind))) break
    }
  }
  for (const root of info.roots) await scan(await convert(root), 0, 'Windows', kind)
  for (const root of [info.programs, info.programsX86].filter(Boolean))
    await scan(await convert(win32.join(root, 'JetBrains')), 2, 'Windows', kind)
  await scanToolbox(
    await convert(win32.join(info.local, 'JetBrains/Toolbox')),
    'Windows',
    kind,
    convert,
  )
  return [...found.values()]
}

async function macAppExists(app: string) {
  const root = join(app, 'Contents/MacOS')
  try {
    for (const file of await readdir(root)) if (await executable(join(root, file))) return true
    return false
  } catch (error) {
    if (missing(error)) return false
    throw error
  }
}

function desktopRoots() {
  return [
    join(process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'applications'),
    ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
      .split(':')
      .filter(Boolean)
      .map((root) => join(root, 'applications')),
  ]
}
async function desktopSection(path: string) {
  const contents = await readFile(path, 'utf8')
  const section = contents.split(/^\[Desktop Entry\]\s*$/m)[1]?.split(/^\[/m)[0]
  if (
    !section ||
    /^Hidden\s*=\s*true\s*$/m.test(section) ||
    !/^Type\s*=\s*Application\s*$/m.test(section)
  )
    return undefined
  return section
}
async function desktopExecutable(section: string) {
  const required = /^TryExec\s*=\s*(.+)$/m.exec(section)?.[1]?.trim()
  if (
    required &&
    !(required.startsWith('/') ? await executable(required) : await commandOnPath([required]))
  )
    return undefined
  const command = /^Exec\s*=\s*(.+)$/m.exec(section)?.[1]
  if (!command) return undefined
  const words = parse(command, (name) => `$${name}`)
  let first: (typeof words)[number] | undefined = words[0]
  if (first === 'env')
    first = words.slice(1).find((word) => typeof word === 'string' && !word.includes('='))
  if (typeof first !== 'string' || ['sh', 'bash', 'flatpak', 'snap'].includes(first))
    return undefined
  return first.startsWith('/')
    ? (await executable(first))
      ? first
      : undefined
    : commandOnPath([first])
}
async function linuxFolderOpener() {
  const mime = await commandOnPath(['xdg-mime'])
  const gio = await commandOnPath(['gio'])
  const xdg = await commandOnPath(['xdg-open'])
  if (mime && (gio || xdg)) {
    const result = await exec(mime, ['query', 'default', 'inode/directory'], {
      timeout: 5000,
      env: processEnvironment(),
      maxBuffer: 1024 * 1024,
    })
    const name = result.stdout.trim()
    if (name.endsWith('.desktop') && !/[\\/]/.test(name))
      for (const root of desktopRoots()) {
        const path = join(root, name)
        if (!(await existingFile(path))) continue
        const section = await desktopSection(path)
        if (section && (await desktopExecutable(section))) {
          if (gio) return { executable: gio, prefix: ['launch', path] }
          if (xdg) return { executable: xdg, prefix: [] }
        }
        // A user entry can mask the system entry, including when marked Hidden.
        break
      }
  }
  const binary = await commandOnPath([
    'nautilus',
    'dolphin',
    'thunar',
    'nemo',
    'pcmanfm',
    'pcmanfm-qt',
    'caja',
  ])
  return binary ? { executable: binary, prefix: [] } : undefined
}

async function detectDesktopEntries(
  found: Map<RepositoryOpenTarget, InstalledOpener>,
  add: (
    target: EditorTarget,
    path: string,
    kind?: InstalledOpener['kind'],
    prefix?: string[],
    productPath?: string,
  ) => Promise<boolean>,
) {
  const gio = await commandOnPath(['gio'])
  if (!gio) return
  const seen = new Set<string>()
  for (const root of desktopRoots()) {
    let entries: string[]
    try {
      entries = await readdir(root)
    } catch (error) {
      if (missing(error)) continue
      throw error
    }
    for (const name of entries.filter((name) => name.endsWith('.desktop'))) {
      if (seen.has(name)) continue
      seen.add(name)
      const path = join(root, name)
      const section = await desktopSection(path)
      if (!section) continue
      const label = /^Name\s*=\s*(.+)$/m.exec(section)?.[1]?.trim()
      const editor = editors.find(
        (editor) =>
          editor.mac.some((app) => label === app) ||
          editor.cli.some((cli) => name === `${cli}.desktop`) ||
          editor.flatpak.some((id) => name === `${id}.desktop`),
      )
      if (!editor || found.has(editor.target)) continue
      const binary = await desktopExecutable(section)
      if (binary) await add(editor.target, gio, 'native', ['launch', path], binary)
    }
  }
}
