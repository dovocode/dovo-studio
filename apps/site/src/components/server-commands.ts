const installer =
  'https://raw.githubusercontent.com/dovocode/dovo-studio/main/scripts/install-linux-server.sh'

export const serverCommands = {
  stable: `bash -o pipefail -c 'curl -fsSL ${installer} | bash -s -- --channel stable --host 0.0.0.0 && "$HOME/.local/bin/dovo-server" pair'`,
  nightly: `bash -o pipefail -c 'curl -fsSL ${installer} | bash -s -- --channel nightly --host 0.0.0.0 && "$HOME/.local/bin/dovo-server-nightly" pair'`,
}
