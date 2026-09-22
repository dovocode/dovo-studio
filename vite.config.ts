import { defineConfig } from 'vite-plus'

export default defineConfig({
  lint: {
    plugins: ['typescript'],
    ignorePatterns: [
      '**/dist/**',
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
        files: ['apps/api/**', 'apps/desktop/electron/**'],
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
    ignorePatterns: ['work/**', '**/generated/browser-viewer.ts'],
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
    include: [
      'packages/**/*.test.ts',
      'apps/mobile/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/desktop/electron/**/*.test.ts',
    ],
  },
  staged: {
    '*.{js,jsx,ts,tsx,json,md,yml,yaml,toml}': 'vp check --fix',
  },
})
