import type { ContainerSandbox } from '@dovo/protocol'

/** What a sandboxed agent needs to know about its environment. */
export function sandboxInstructions(cwd: string, sandbox: ContainerSandbox | undefined) {
  return [
    `Project working directory: ${JSON.stringify(cwd)}. This thread runs inside a Linux container sandbox (Debian with mise). The checkout is mounted at the same path; files outside it, other projects and the host home directory are not available.`,
    'Run git and gh from the checkout as usual. gh has no GitHub login unless the user configured one for this harness.',
    'The repository Git config and hooks folder are read-only here, so `git config` writes (without --global), `git push -u`, `git remote add` and hook installers fail. Do not work around this; ask the user to make such changes on the host.',
    'mise manages tools. The project mise.toml, .tool-versions and version files such as .nvmrc are trusted and installed. If a command or language version is missing, install it with `mise use <tool>@<version>` (for example `mise use python@3.12`); add it to the project mise.toml only when the project should keep it.',
    sandbox?.network === 'none'
      ? 'The sandbox has no network access. Package downloads and web requests fail; tools already installed in the shared mise cache still work.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}
