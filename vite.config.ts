import { defineConfig } from 'vite-plus'

// Cache whole verification builds with explicit inputs/outputs. Automatic process
// tracing cannot reliably follow native compiler children on every Linux host.
const workspaceInputs = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.node-version',
  'tsconfig*.json',
  'vite.config.ts',
  'patches/**',
  'scripts/**',
  'apps/**',
  'packages/**',
  '!**/node_modules/**',
  '!**/node_modules',
  '!**/dist/**',
  '!**/dist',
  '!**/dist-electron/**',
  '!**/dist-electron',
  '!**/.next/**',
  '!**/.next',
  '!**/.expo/**',
  '!**/.expo',
  '!**/.vite/**',
  '!**/.vite',
  '!**/*.tsbuildinfo',
  '!apps/site/out/**',
  '!apps/site/out',
  '!apps/site/next-env.d.ts',
  '!apps/design-system/storybook-static/**',
  '!apps/design-system/storybook-static',
  '!apps/design-system/src/hosted-screens.generated.json',
  '!apps/design-system/public/website/**',
  '!apps/design-system/public/website',
  '!apps/mobile/ios/**',
  '!apps/mobile/android/**',
  '!apps/mobile/modules/*/android/build/**',
  '!apps/mobile/assets/terminal.json',
  '!apps/mobile/assets/remote-desktop.json',
  '!apps/mobile/assets/mermaid.json',
  '!packages/protocol/src/generated/browser-viewer.ts',
  '!packages/studio-ui/mcp-apps/host.json',
  '!packages/studio-ui/mcp-apps/sandbox.json',
  '!packages/runtime/native/ios-device/target/**',
]

export default defineConfig({
  run: {
    tasks: {
      'ci-build': {
        command: 'pnpm build',
        cache: {
          input: workspaceInputs,
          output: [
            'packages/*/dist/**',
            'apps/*/dist/**',
            'apps/desktop/dist-electron/**',
            'apps/site/out/**',
            'apps/site/.next/types/**',
            'apps/site/next-env.d.ts',
            'apps/design-system/storybook-static/**',
            'apps/design-system/src/hosted-screens.generated.json',
            'apps/design-system/public/website/**',
            'apps/mobile/assets/terminal.json',
            'apps/mobile/assets/remote-desktop.json',
            'apps/mobile/assets/mermaid.json',
            'packages/protocol/src/generated/browser-viewer.ts',
            'packages/studio-ui/mcp-apps/host.json',
            'packages/studio-ui/mcp-apps/sandbox.json',
          ],
          env: ['VITE_*', 'NEXT_PUBLIC_*', 'NODE_ENV', 'CI'],
          // Invocation IDs and browser-check settings do not affect compiled outputs.
          untrackedEnv: ['CODEX_*', 'DOVO_BROWSER_TIMINGS', 'DOVO_DESIGN_*'],
        },
      },
      'ci-typecheck': {
        command: 'pnpm typecheck',
        cache: {
          input: workspaceInputs,
          output: [],
          untrackedEnv: ['CODEX_*', 'DOVO_BROWSER_TIMINGS', 'DOVO_DESIGN_*'],
        },
      },
    },
  },
  lint: {
    plugins: ['typescript'],
    ignorePatterns: [
      '**/dist/**',
      '**/.next/**',
      'apps/site/out/**',
      'apps/site/next-env.d.ts',
      '**/node_modules/**',
      '**/.expo/**',
      '**/routeTree.gen.ts',
      'work/**',
      '**/generated/browser-viewer.ts',
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
      'typescript/no-explicit-any': 'error',
    },
    overrides: [
      {
        files: [
          'apps/api/**',
          'apps/notification-relay/**',
          'apps/connect-server/**',
          'apps/auth-server/**',
          'apps/artifact-server/**',
          'apps/review-demo/**',
          'apps/desktop/electron/**',
        ],
        env: { node: true },
      },
      {
        files: ['apps/desktop/src/**', 'apps/mobile/**', 'apps/web/**'],
        env: { browser: true },
      },
      {
        files: ['**/*.test.ts', '**/*.test.tsx'],
        plugins: ['vitest'],
        rules: {
          'vitest/no-disabled-tests': 'error',
        },
      },
    ],
  },
  fmt: {
    // Design snapshots and downloaded references are not application source.
    ignorePatterns: [
      'work/**',
      '**/generated/browser-viewer.ts',
      '**/.next/**',
      'apps/site/out/**',
      'apps/site/next-env.d.ts',
    ],
    semi: false,
    singleQuote: true,
    printWidth: 100,
    overrides: [
      {
        files: ['**/*.md'],
        options: { proseWrap: 'always' },
      },
    ],
  },
  test: {
    // Effect v4 yields through setImmediate; keep scheduler handoffs live with fake clocks.
    fakeTimers: {
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'Date',
        'performance',
        'hrtime',
      ],
    },
    setupFiles: ['./scripts/test-runtime-environment.ts'],
    include: [
      'packages/**/*.test.ts',
      'apps/mobile/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/notification-relay/src/**/*.test.ts',
      'apps/connect-server/src/**/*.test.ts',
      'apps/auth-server/src/**/*.test.ts',
      'apps/artifact-server/src/**/*.test.ts',
      'apps/review-demo/src/**/*.test.ts',
      'apps/desktop/electron/**/*.test.ts',
    ],
  },
  staged: {
    '*.{js,jsx,ts,tsx,json,md,yml,yaml,toml}': 'vp check --fix',
  },
})
