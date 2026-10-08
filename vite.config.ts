import { defineConfig } from 'vite-plus'

export default defineConfig({
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
        files: ['apps/api/**', 'apps/notification-relay/**', 'apps/desktop/electron/**'],
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
      'apps/desktop/electron/**/*.test.ts',
    ],
  },
  staged: {
    '*.{js,jsx,ts,tsx,json,md,yml,yaml,toml}': 'vp check --fix',
  },
})
