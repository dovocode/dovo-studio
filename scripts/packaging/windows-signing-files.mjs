import { open, readdir, writeFile, appendFile } from 'node:fs/promises'
import { join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

export async function windowsSigningFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await windowsSigningFiles(path)))
    else if (
      entry.isFile() &&
      ['.exe', '.dll', '.node'].includes(extname(entry.name).toLowerCase())
    ) {
      const file = await open(path, 'r')
      try {
        const header = Buffer.alloc(64)
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        if (bytesRead !== 64 || header.readUInt16LE(0) !== 0x5a4d) continue
        const signature = Buffer.alloc(4)
        await file.read(signature, 0, signature.length, header.readUInt32LE(0x3c))
        if (signature.equals(Buffer.from([0x50, 0x45, 0, 0]))) files.push(resolve(path))
      } finally {
        await file.close()
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  if (!directory || !process.env.GITHUB_OUTPUT)
    throw new Error('Usage: windows-signing-files.mjs <directory> in GitHub Actions')
  const files = await windowsSigningFiles(resolve(directory))
  if (!files.length) throw new Error('No Windows PE binaries found to sign')
  await writeFile('work/windows-signing-files.json', JSON.stringify(files))
  const delimiter = randomUUID()
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `files<<${delimiter}\n${files.join('\n')}\n${delimiter}\n`,
  )
}
