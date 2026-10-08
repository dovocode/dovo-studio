// Tests create isolated runtimes and settings in their own temporary directories.
// Do not inherit the launcher flags or the desktop app's real settings file.
delete process.env.DOVO_SETTINGS_PATH
delete process.env.DOVO_DESKTOP_DUAL_LISTENER
// A packaged Dovo launcher must not turn source-release fixtures into archive installs.
for (const key of [
  'DOVO_SERVER_DISTRIBUTION',
  'DOVO_RELEASE_DISTRIBUTION',
  'DOVO_RELEASE_VERSION',
  'DOVO_RELEASE_CHANNEL',
  'DOVO_RUNTIME_ENV_FILE',
  'DOVO_OWNER_TOKEN',
  'DOVO_DATABASE_PATH',
])
  delete process.env[key]
