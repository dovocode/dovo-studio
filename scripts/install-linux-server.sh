#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'Dovo install failed: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: install-linux-server.sh [--channel stable|nightly] [--data-dir PATH] [--host HOST]

Install or upgrade the standalone Linux server and its systemd user service.
Run as your normal user, without sudo. Existing data and pairings are preserved.
EOF
}

channel=stable
data_dir="$HOME/.dovo"
host=
while (($#)); do
  case "$1" in
    --channel|--data-dir|--host)
      (($# >= 2)) || fail "Missing value for $1"
      case "$1" in
        --channel) channel=$2 ;;
        --data-dir) data_dir=$2 ;;
        --host) host=$2 ;;
      esac
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done
[[ "$channel" == stable || "$channel" == nightly ]] || fail 'Channel must be stable or nightly'
[[ "$(uname -s)" == Linux ]] || fail 'This installer supports Linux only'
[[ "$(id -u)" != 0 ]] || fail 'Run as your normal user; Dovo installs a systemd user service'
getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'Published Linux archives require glibc (Alpine/musl is unsupported)'
for command in curl jq tar sha256sum systemctl realpath mktemp; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done
systemctl --user show-environment >/dev/null 2>&1 ||
  fail 'The systemd user manager is unavailable. Log in as your normal user, without sudo, and try again.'
case "$(uname -m)" in
  x86_64) architecture=x64 ;;
  aarch64) architecture=arm64 ;;
  *) fail 'This installer supports Linux x64 and arm64' ;;
esac

api=https://api.github.com/repos/dovocode/dovo-studio/releases
github_token=${GH_TOKEN:-}
[[ "$github_token" =~ ^[A-Za-z0-9_]+$ ]] || github_token=${GITHUB_TOKEN:-}
[[ "$github_token" =~ ^[A-Za-z0-9_]+$ ]] || github_token=
if [[ -z "$github_token" ]] && command -v gh >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    github_token=$(GH_PROMPT_DISABLED=1 timeout 5s gh auth token --hostname github.com 2>/dev/null) || github_token=
  else
    github_token=$(GH_PROMPT_DISABLED=1 gh auth token --hostname github.com 2>/dev/null) || github_token=
  fi
fi
[[ "$github_token" =~ ^[A-Za-z0-9_]+$ ]] || github_token=
github_api() {
  if [[ -n "$github_token" ]]; then
    # Feed the header through stdin so credentials never appear in curl's command arguments.
    printf 'header = "Authorization: Bearer %s"\n' "$github_token" |
      curl -fsSL --retry 2 --config - -H 'Accept: application/vnd.github+json' "$1"
  else
    curl -fsSL --retry 2 -H 'Accept: application/vnd.github+json' "$1"
  fi
}
if [[ "$channel" == stable ]]; then
  release=$(github_api "$api/latest") ||
    fail 'Could not load the latest Stable release'
else
  releases=$(github_api "$api?per_page=30") ||
    fail 'Could not load Nightly releases'
  release=$(jq -c '[.[] | select(.prerelease and (.draft | not) and (.tag_name | test("-nightly[.]")))][0] // empty' <<<"$releases") ||
    fail 'Invalid release metadata'
fi
[[ -n "$release" ]] || fail "No published $channel release was found"
tag=$(jq -r '.tag_name // empty' <<<"$release")
[[ "$tag" =~ ^v[A-Za-z0-9._-]+$ ]] || fail 'Invalid release tag'
prefix=Dovo-Server-
[[ "$channel" == nightly ]] && prefix=Dovo-Server-Nightly-
suffix="-linux-$architecture.tar.gz"
asset=$(jq -c --arg prefix "$prefix" --arg suffix "$suffix" \
  '[.assets[] | select((.name | startswith($prefix) and endswith($suffix)) and ((.name | contains("-Nightly-")) == ($prefix == "Dovo-Server-Nightly-")))][0] // empty' \
  <<<"$release") || fail 'Invalid release asset metadata'
[[ -n "$asset" ]] || fail "No Linux $architecture server archive exists in $tag"
asset_name=$(jq -r '.name' <<<"$asset")
url=$(jq -r '.browser_download_url // empty' <<<"$asset")
digest=$(jq -r '.digest // empty' <<<"$asset")
size=$(jq -r '(.size // 0) / 1048576 | floor' <<<"$asset")
[[ "$url" == "https://github.com/dovocode/dovo-studio/releases/download/$tag/"* ]] ||
  fail 'Release asset has an unexpected download URL'
[[ "$digest" =~ ^sha256:([0-9a-f]{64})$ ]] || fail 'Release asset has no valid SHA-256 digest'
expected=${BASH_REMATCH[1]}

case "$data_dir" in
  '~') data_dir=$HOME ;;
  \~/*) data_dir="$HOME/${data_dir#\~/}" ;;
esac
data_dir=$(realpath -m -- "$data_dir")
root="$HOME/.local/share/dovo/server/$channel"
destination="$root/$tag"
launcher_name=dovo-server
[[ "$channel" == nightly ]] && launcher_name=dovo-server-nightly
launcher="$destination/bin/$launcher_name"
bin_dir="$HOME/.local/bin"
shortcut="$bin_dir/$launcher_name"
if [[ -e "$shortcut" || -L "$shortcut" ]]; then
  [[ -L "$shortcut" ]] || fail "$shortcut already belongs to another installation"
  current=$(realpath -m -- "$shortcut")
  [[ "$current" == "$root/"* ]] || fail "$shortcut already belongs to another installation"
fi
[[ ! -e "$destination" || -f "$launcher" ]] ||
  fail "Incomplete server release at $destination; move it aside and retry"

stage=
link_stage=
cleanup() {
  [[ -z "$stage" ]] || rm -rf -- "$stage"
  [[ -z "$link_stage" ]] || rm -rf -- "$link_stage"
}
trap cleanup EXIT
if [[ ! -f "$launcher" ]]; then
  mkdir -p -- "$root"
  stage=$(mktemp -d "$root/.dovo-install.XXXXXXXX")
  archive="$stage/server.tar.gz"
  printf 'Downloading %s (%s MiB)...\n' "$asset_name" "$size"
  curl -fLsS --retry 2 -o "$archive" "$url" || fail 'Server download failed'
  printf '%s  %s\n' "$expected" "$archive" | sha256sum -c - >/dev/null ||
    fail 'Server archive checksum did not match the published release'
  mkdir -- "$stage/extracted"
  tar -xzf "$archive" -C "$stage/extracted"
  candidate="$stage/extracted/bin/$launcher_name"
  [[ -f "$candidate" ]] || fail 'Server archive has no launcher'
  "$candidate" --help >/dev/null || fail 'The downloaded server launcher did not start'
  mv -- "$stage/extracted" "$destination"
fi

record="$data_dir/server-service.json"
if [[ -f "$record" ]]; then
  registered=$(jq -r '.launcher // empty' "$record") || fail 'Invalid server service record'
  if [[ "$registered" == "$launcher" ]]; then
    status=$("$launcher" service status --data-dir "$data_dir" --json 2>/dev/null) || status=
    if ! jq -e '.running == true' >/dev/null 2>&1 <<<"$status"; then
      "$launcher" service restart --data-dir "$data_dir"
    fi
  else
    "$launcher" service update --data-dir "$data_dir" --launcher "$launcher"
  fi
else
  install=("$launcher" service install --data-dir "$data_dir")
  [[ -z "$host" ]] || install+=(--host "$host")
  "${install[@]}"
fi

mkdir -p -- "$bin_dir"
link_stage=$(mktemp -d "$bin_dir/.dovo-link.XXXXXXXX")
ln -s -- "$launcher" "$link_stage/$launcher_name"
mv -Tf -- "$link_stage/$launcher_name" "$shortcut"
printf 'Installed %s. Pair a device with: %s pair --data-dir %q\n' "$tag" "$shortcut" "$data_dir"
printf 'Run this installer again to upgrade. Workspace data and pairings are preserved.\n'
