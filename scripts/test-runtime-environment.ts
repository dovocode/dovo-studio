// Tests create isolated runtimes and settings in their own temporary directories.
// Do not inherit the launcher flags or the desktop app's real settings file.
delete process.env.DOVO_SETTINGS_PATH
delete process.env.DOVO_DESKTOP_DUAL_LISTENER
