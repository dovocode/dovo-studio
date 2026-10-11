import { expect, it } from 'vite-plus/test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitService } from '../git/git'
import { relatedFileGroups } from './order'
it('reads complete immutable local PR sources, including renames, without changing the checkout', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-review-sources-'))
  const git = new GitService()
  try {
    await git.command(cwd, ['init', '-b', 'main'])
    await git.command(cwd, ['config', 'user.name', 'Test'])
    await git.command(cwd, ['config', 'user.email', 'test@example.test'])
    await writeFile(join(cwd, 'old.ts'), 'export const value = 1\n')
    await git.command(cwd, ['add', '.'])
    await git.command(cwd, ['commit', '-m', 'base'])
    const base = (await git.command(cwd, ['rev-parse', 'HEAD'])).trim()
    await git.command(cwd, ['mv', 'old.ts', 'new.ts'])
    await writeFile(
      join(cwd, 'view.tsx'),
      "import {value} from './new'; export const View = () => <div>{value}</div>\n",
    )
    await writeFile(join(cwd, 'large.ts'), 'a'.repeat(300_000))
    await git.command(cwd, ['add', '.'])
    await git.command(cwd, ['commit', '-m', 'changes'])
    const head = (await git.command(cwd, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(cwd, 'view.tsx'), 'unsaved local changes')
    const before = await git.command(cwd, ['status', '--porcelain'])
    const sources = await git.reviewSources(cwd, base, head, [
      { path: 'new.ts', previousPath: 'old.ts' },
      { path: 'view.tsx' },
      { path: 'large.ts' },
    ])
    expect(sources).toEqual([
      {
        path: 'new.ts',
        previousPath: 'old.ts',
        before: 'export const value = 1\n',
        after: 'export const value = 1\n',
      },
      {
        path: 'view.tsx',
        previousPath: undefined,
        before: '',
        after: "import {value} from './new'; export const View = () => <div>{value}</div>\n",
      },
    ])
    expect(await git.command(cwd, ['status', '--porcelain'])).toBe(before)
    expect(await git.reviewSources(cwd, '0'.repeat(40), head, [{ path: 'view.tsx' }])).toEqual([])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
it('reads immutable Go module metadata and groups local imports without using dirty workspace manifests', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-review-go-'))
  const git = new GitService()
  try {
    await git.command(cwd, ['init', '-b', 'main'])
    await git.command(cwd, ['config', 'user.name', 'Test'])
    await git.command(cwd, ['config', 'user.email', 'test@example.test'])
    await mkdir(join(cwd, 'model'))
    await writeFile(join(cwd, 'go.mod'), 'module example.com/project\ngo 1.25\n')
    await writeFile(join(cwd, 'model/user.go'), 'package model\ntype User struct {}\n')
    await writeFile(
      join(cwd, 'view.go'),
      'package api\nimport "example.com/project/model"\nvar user model.User\n',
    )
    await git.command(cwd, ['add', '.'])
    await git.command(cwd, ['commit', '-m', 'base'])
    const base = (await git.command(cwd, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(cwd, 'model/user.go'), 'package model\ntype User struct { ID int }\n')
    await git.command(cwd, ['add', '.'])
    await git.command(cwd, ['commit', '-m', 'changes'])
    const head = (await git.command(cwd, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(cwd, 'go.mod'), 'module unrelated.example.com/project\n')
    const files = [{ path: 'view.go' }, { path: 'model/user.go' }]
    const sources = await git.reviewSources(cwd, base, head, files)
    const modules = await git.reviewGoModules(cwd, files, base, head, true)
    expect(modules).toEqual([
      {
        path: 'go.mod',
        before: 'module example.com/project\ngo 1.25\n',
        after: 'module example.com/project\ngo 1.25\n',
      },
    ])
    expect(await relatedFileGroups(sources, modules)).toEqual([
      { label: 'model/user.go', paths: ['model/user.go', 'view.go'], basis: 'ast' },
    ])
    expect((await git.reviewGoModules(cwd, files))[0].after).toBe(
      'module unrelated.example.com/project\n',
    )
    await writeFile(join(cwd, 'go.mod'), 'a'.repeat(40_000))
    expect(await git.reviewGoModules(cwd, files)).toEqual([])
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
it('reads immutable PHP declarations and includes for renamed files without using dirty sources', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dovo-review-php-'))
  const git = new GitService()
  try {
    await git.command(cwd, ['init', '-b', 'main'])
    await git.command(cwd, ['config', 'user.name', 'Test'])
    await git.command(cwd, ['config', 'user.email', 'test@example.test'])
    await writeFile(join(cwd, 'old.php'), '<?php namespace App; class User {}\n')
    await writeFile(join(cwd, 'view.phtml'), '<?php require __DIR__ . "/old.php";\n')
    await git.command(cwd, ['add', '.'])
    await git.command(cwd, ['commit', '-m', 'base'])
    const base = (await git.command(cwd, ['rev-parse', 'HEAD'])).trim()
    await git.command(cwd, ['mv', 'old.php', 'new.php'])
    await writeFile(join(cwd, 'view.phtml'), '<?php use App\\User as Person; new Person();\n')
    await git.command(cwd, ['add', '.'])
    await git.command(cwd, ['commit', '-m', 'changes'])
    const head = (await git.command(cwd, ['rev-parse', 'HEAD'])).trim()
    await writeFile(join(cwd, 'new.php'), '<?php namespace Unrelated; class Other {}\n')
    await writeFile(join(cwd, 'view.phtml'), '<?php // local changes\n')
    const status = await git.command(cwd, ['status', '--porcelain'])
    const sources = await git.reviewSources(cwd, base, head, [
      { path: 'new.php', previousPath: 'old.php' },
      { path: 'view.phtml' },
    ])
    expect(sources).toEqual([
      {
        path: 'new.php',
        previousPath: 'old.php',
        before: '<?php namespace App; class User {}\n',
        after: '<?php namespace App; class User {}\n',
      },
      {
        path: 'view.phtml',
        previousPath: undefined,
        before: '<?php require __DIR__ . "/old.php";\n',
        after: '<?php use App\\User as Person; new Person();\n',
      },
    ])
    expect(await relatedFileGroups(sources)).toEqual([
      { label: 'new.php', paths: ['new.php', 'view.phtml'], basis: 'ast' },
    ])
    expect(await git.command(cwd, ['status', '--porcelain'])).toBe(status)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
