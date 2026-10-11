import { expect, it } from 'vite-plus/test'
import { relatedFileGroups } from './order'
const paths = async (files: Parameters<typeof relatedFileGroups>[0]) =>
  (
    await relatedFileGroups(files, [
      { path: 'go.mod', before: 'module example.com/project', after: 'module example.com/project' },
    ])
  )
    .filter((group) => group.basis === 'ast')
    .map((group) => group.paths)
it('orders TypeScript/JSX dependencies before their transitive callers and tests', async () => {
  const files = [
    { path: 'src/a.test.ts', after: "import {view} from './b.js'; test(view)" },
    {
      path: 'src/b.tsx',
      after: "import type { Props } from './z'; export const view = (props: Props) => <div/>",
    },
    { path: 'src/z.ts', after: 'export type Props = { name: string }' },
  ]
  expect(await paths(files)).toEqual([['src/z.ts', 'src/b.tsx', 'src/a.test.ts']])
  expect(await paths([...files].reverse())).toEqual(await paths(files))
})
it('links re-exports, require and dynamic imports, including renamed/deleted imports from the old version', async () => {
  expect(
    await paths([
      {
        path: 'api/new.ts',
        previousPath: 'api/old.ts',
        before: 'export const x = 1',
        after: 'export const x = 2',
      },
      { path: 'client.ts', before: "export {x} from './api/old'", after: 'export const other = 1' },
      { path: 'dynamic.js', after: "import('./client'); const api = require('./api/new')" },
    ]),
  ).toEqual([['api/new.ts', 'client.ts', 'dynamic.js']])
})
it('does not turn comments, strings, malformed source or similar filenames into dependency links', async () => {
  const groups = await relatedFileGroups([
    { path: 'a.ts', after: '// import x from "./b"\nconst text = `require("./b")`' },
    { path: 'b.ts', after: 'export const b = 1' },
    { path: 'c.ts', after: 'import { x } from "./b"; function broken(' },
    { path: 'other/b.ts', after: 'export const b = 2' },
  ])
  expect(groups.every((group) => group.basis === 'folder')).toBe(true)
})
it('resolves index modules and cycles deterministically without mixing same basenames', async () => {
  const files = [
    { path: 'a/index.ts', after: "export {value} from '../b'" },
    { path: 'b.ts', after: "import {value} from './a'; export const other = value" },
    { path: 'other/b.ts', after: 'export const unrelated = true' },
  ]
  expect(await paths(files)).toEqual([['b.ts', 'a/index.ts']])
  expect((await relatedFileGroups(files)).find((group) => group.basis === 'folder')?.paths).toEqual(
    ['other/b.ts'],
  )
})
it('labels incomplete sources and unresolved imports as folder fallback', async () => {
  expect(
    await relatedFileGroups([
      { path: 'src/app.ts' },
      { path: 'src/model.py', after: 'from app import x' },
    ]),
  ).toEqual([{ label: 'src', paths: ['src/app.ts', 'src/model.py'], basis: 'folder' }])
})
it('resolves explicit ESM and CommonJS extensions without confusing TypeScript module kinds', async () => {
  expect(
    await paths([
      { path: 'a.ts', after: "import {z} from './z.mjs'; import {c} from './c.cjs'" },
      { path: 'z.ts', after: 'export const wrong = true' },
      { path: 'z.mts', after: 'export const z = 1' },
      { path: 'c.ts', after: 'export const wrong = true' },
      { path: 'c.cts', after: 'export const c = 1' },
    ]),
  ).toEqual([['c.cts', 'z.mts', 'a.ts']])
})
it.each([
  [
    'Python',
    'src/api/view.py',
    'from .models import User\n',
    'src/api/models.py',
    'class User:\n    pass\n',
  ],
  [
    'Python absolute',
    'src/api/view.py',
    'import api.models as models\n',
    'src/api/models.py',
    'class User:\n    pass\n',
  ],
  [
    'Go packages',
    'api/view.go',
    'package api\nimport "example.com/project/model"\nvar user model.User\n',
    'model/user.go',
    'package model\ntype User struct {}\n',
  ],
  [
    'Go same package',
    'api/view.go',
    'package api\nvar user User\n',
    'api/user.go',
    'package api\ntype User struct {}\n',
  ],
  [
    'Rust',
    'src/api.rs',
    'use crate::model::{User};\nfn view(user: User) {}',
    'src/model.rs',
    'pub struct User;',
  ],
  [
    'Java',
    'api/View.java',
    'package api; import model.User; class View { User user; }',
    'model/User.java',
    'package model; public class User {}',
  ],
  [
    'Kotlin',
    'api/View.kt',
    'package api\nimport model.User as Person\nclass View(val user: Person)',
    'model/User.kt',
    'package model\nclass User',
  ],
  [
    'Swift',
    'Sources/App/API/View.swift',
    'struct View { let user: User }',
    'Sources/App/Model/User.swift',
    'struct User { let id: Int }',
  ],
  [
    'C#',
    'api/View.cs',
    'using Model; namespace API; class View { User user; }',
    'model/User.cs',
    'namespace Model; public class User {}',
  ],
])(
  'groups %s dependencies before their callers',
  async (_language, caller, source, dependency, definition) => {
    expect(
      await paths([
        { path: caller, after: source },
        { path: dependency, after: definition },
      ]),
    ).toEqual([[dependency, caller]])
  },
)
it('ignores import-looking comments, strings and invalid syntax across grammars', async () => {
  const groups = await relatedFileGroups([
    { path: 'a.py', after: '# from b import User\ntext = "import b"\n' },
    { path: 'b.py', after: 'class User:\n    pass\n' },
    { path: 'broken.py', after: 'from b import User\ndef broken(' },
    {
      path: 'src/a.rs',
      after: '// use crate::b::User;\nconst TEXT: &str = "use crate::b::User;";',
    },
    { path: 'src/b.rs', after: 'struct User;' },
  ])
  expect(groups.every((group) => group.basis === 'folder')).toBe(true)
})
it.each([
  [
    'Rust super',
    'src/api/view.rs',
    'use super::User; fn view(user: User) {}',
    'src/api.rs',
    'pub struct User;',
  ],
  ['Rust module declaration', 'src/lib.rs', 'pub mod model;', 'src/model.rs', 'pub struct User;'],
  [
    'Java qualified type',
    'api/View.java',
    'package api; class View { model.User user; }',
    'model/User.java',
    'package model; public class User {}',
  ],
  [
    'Java same package',
    'api/View.java',
    'package api; class View { User user; }',
    'api/User.java',
    'package api; public class User {}',
  ],
  [
    'Java wildcard',
    'api/View.java',
    'package api; import model.*; class View { User user; }',
    'model/User.java',
    'package model; public class User {}',
  ],
  [
    'Kotlin function',
    'api/View.kt',
    'package api\nimport model.user\nfun view() = user()',
    'model/user.kt',
    'package model\nfun user() = 1',
  ],
  [
    'Swift module import',
    'Tests/AppTests/View.swift',
    'import Models\nstruct View { let user: User }',
    'Sources/Models/User.swift',
    'struct User { let id: Int }',
  ],
  [
    'C# qualified type',
    'api/View.cs',
    'namespace API; class View { Model.User user; }',
    'model/User.cs',
    'namespace Model; public class User {}',
  ],
])('resolves %s relationships', async (_language, caller, source, dependency, definition) => {
  expect(
    await paths([
      { path: caller, after: source },
      { path: dependency, after: definition },
    ]),
  ).toEqual([[dependency, caller]])
})
it('retains Python dependencies from deleted imports and renamed modules', async () => {
  expect(
    await paths([
      {
        path: 'api/new.py',
        previousPath: 'api/old.py',
        before: 'class User:\n    pass\n',
        after: 'class User:\n    pass\n',
      },
      { path: 'api/view.py', before: 'from .old import User\n', after: '# dependency removed\n' },
    ]),
  ).toEqual([['api/new.py', 'api/view.py']])
})
it('does not confuse external Go packages with local names or cross nested module boundaries', async () => {
  expect(
    await paths([
      {
        path: 'api/view.go',
        after: 'package api\nimport "net/http"\nimport "other.example.com/model"\n',
      },
      { path: 'http/server.go', after: 'package http\ntype Server struct{}' },
      { path: 'model/user.go', after: 'package model\ntype User struct{}' },
    ]),
  ).toEqual([])
  const groups = await relatedFileGroups(
    [
      { path: 'api/view.go', after: 'package api\nimport "example.com/project/model"\n' },
      { path: 'model/user.go', after: 'package model\ntype User struct{}' },
    ],
    [
      { path: 'go.mod', after: 'module example.com/project' },
      { path: 'model/go.mod', after: 'module other.example.com/model' },
    ],
  )
  expect(groups.every((group) => group.basis === 'folder')).toBe(true)
})
it('keeps ambiguous Python source roots and duplicate named types in the folder fallback', async () => {
  expect(
    await paths([
      { path: 'view.py', after: 'import api.models\n' },
      { path: 'first/api/models.py', after: 'class User:\n    pass\n' },
      { path: 'second/api/models.py', after: 'class User:\n    pass\n' },
      { path: 'View.java', after: 'import model.User; class View { User user; }' },
      { path: 'first/User.java', after: 'package model; class User {}' },
      { path: 'second/User.java', after: 'package model; class User {}' },
    ]),
  ).toEqual([])
})
it('resolves old and new imports separately when a renamed path is reused by a new file', async () => {
  expect(
    await paths([
      {
        path: 'new.ts',
        previousPath: 'old.ts',
        before: 'export const original = 1',
        after: 'export const original = 2',
      },
      { path: 'old.ts', before: '', after: 'export const replacement = 1' },
      {
        path: 'caller.ts',
        before: "import {original} from './old'",
        after: "import {replacement} from './old'",
      },
    ]),
  ).toEqual([['new.ts', 'old.ts', 'caller.ts']])
})
it('handles TypeScript type-only import expressions, import-equals and angle assertions in .ts files', async () => {
  expect(
    await paths([
      { path: 'types.ts', after: 'export type Props = {name:string}' },
      {
        path: 'caller.ts',
        after:
          'import types = require("./types"); type Props = import("./types").Props; const count = <number>1;',
      },
    ]),
  ).toEqual([['types.ts', 'caller.ts']])
})
it.each([
  [
    'aliased class import',
    '<?php namespace App\\View; use App\\Model\\User as Person; class View { public Person $user; }',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'grouped import in a namespace block',
    '<?php namespace App\\View { use App\\Model\\{User as Person, Other}; class View { public Person $user; } }',
    '<?php namespace App\\Model { class User {} }',
  ],
  [
    'namespace alias',
    '<?php namespace App\\View; use App\\Model as M; class View { public M\\User $user; }',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'fully qualified type',
    '<?php namespace App\\View; class View { public \\App\\Model\\User $user; }',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'same namespace nullable and union types',
    '<?php namespace App\\Model; function view(?User $user): User|Other {}',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'relative namespace type',
    '<?php namespace App; class View { public namespace\\Model\\User $user; }',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'interface inheritance',
    '<?php namespace App\\Model; class View implements User {}',
    '<?php namespace App\\Model; interface User {}',
  ],
  [
    'trait use',
    '<?php namespace App\\Model; class View { use User; }',
    '<?php namespace App\\Model; trait User {}',
  ],
  [
    'enum static access',
    '<?php namespace App\\Model; $status = User::Active;',
    '<?php namespace App\\Model; enum User { case Active; }',
  ],
  [
    'case-insensitive class instantiation',
    '<?php namespace app\\model; $user = new uSeR();',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'static call',
    '<?php namespace App\\Model; $user = User::create();',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'instanceof',
    '<?php namespace App\\Model; $valid = $user instanceof User;',
    '<?php namespace App\\Model; class User {}',
  ],
  [
    'attribute',
    '<?php namespace App\\View; #[\\App\\Model\\User] class View {}',
    '<?php namespace App\\Model; class User {}',
  ],
  ['global class in a template', '<div><?php $user = new User(); ?></div>', '<?php class User {}'],
])('resolves PHP %s relationships', async (_name, source, definition) => {
  expect(
    await paths([
      { path: 'a/view.phtml', after: source },
      { path: 'z/user.php', after: definition },
      { path: 'other/User.php', after: '<?php namespace External; class User {}' },
    ]),
  ).toEqual([['z/user.php', 'a/view.phtml']])
})
it.each(['require', 'require_once', 'include', 'include_once'])(
  'resolves PHP %s paths anchored to the including file',
  async (keyword) => {
    expect(
      await paths([
        {
          path: 'src/a/view.php',
          after: `<?php ${keyword} (__DIR__ . '/../z/' . 'user.php'); ${keyword} dirname(__FILE__) . '/helper.inc';`,
        },
        { path: 'src/z/user.php', after: '<?php class User {}' },
        { path: 'src/a/helper.inc', after: '<?php function helper() {}' },
        { path: 'src/other/user.php', after: '<?php class Other {}' },
      ]),
    ).toEqual([['src/a/helper.inc', 'src/z/user.php', 'src/a/view.php']])
  },
)
it('keeps ambiguous PHP declarations and separate namespace scopes in folder order', async () => {
  expect(
    await paths([
      { path: 'view.php', after: '<?php use App\\User; new User();' },
      { path: 'first/User.php', after: '<?php namespace App; class User {}' },
      { path: 'second/User.php', after: '<?php namespace app; class USER {}' },
      {
        path: 'multiple.php',
        after: '<?php namespace A { use App\\Other; } namespace B { class View {} }',
      },
      { path: 'Other.php', after: '<?php namespace App; class Other {}' },
    ]),
  ).toEqual([])
})
it('does not invent PHP links from comments, strings, variable names or unsupported import kinds', async () => {
  expect(
    await paths([
      {
        path: 'view.php',
        after: `<?php namespace App;
          // use App\\User; require __DIR__ . '/User.php';
          $text = 'use App\\User;'; $User = 1; $obj->User();
          $class::User; $class::$User;
          use function App\\User;
          use App\\{const User, function Other};
          User();
          require $file;
          require __DIR__ . "/$name.php";
          require __DIR__ . "/\\x55ser.php";
          require './User.php';
          require 'User.php';
          new External\\User();
        `,
      },
      { path: 'User.php', after: '<?php namespace App; class User {}' },
      { path: 'Other.php', after: '<?php namespace App; class Other {}' },
      { path: 'broken.php', after: '<?php use App\\User; class Broken {' },
    ]),
  ).toEqual([])
})
it('retains PHP dependencies from removed imports, changed namespaces and renamed includes', async () => {
  expect(
    await paths([
      {
        path: 'models/new.php',
        previousPath: 'models/old.php',
        before: '<?php namespace Before; class User {}',
        after: '<?php namespace After; class User {}',
      },
      {
        path: 'caller.php',
        before: '<?php use Before\\User; require __DIR__ . "/models/old.php";',
        after: '<?php // dependencies removed',
      },
    ]),
  ).toEqual([['models/new.php', 'caller.php']])
})
