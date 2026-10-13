#!/bin/sh
# Run inside a clean distro after installing the DEB/RPM and Xvfb/xdotool.
set -eu
directory=/opt/dovo-studio-gpui
"$directory/check-linux.sh"
"$directory/dovo-desktop-gpui" --help
"$directory/libexec/node" /verification/scripts/packaging/gpui-smoke.mjs "$directory"
qa_directory=$(mktemp -d)
trap 'rm -rf "$qa_directory"' EXIT
export XDG_DATA_HOME="$qa_directory/data" XDG_CONFIG_HOME="$qa_directory/config"
export WEBKIT_DISABLE_COMPOSITING_MODE=1
# Software Vulkan exercises loader/driver dependencies on GPU-less CI machines.
xvfb-run -a sh -s -- "$directory" "$qa_directory" <<'GUI_CHECK'
  set -eu
  "$1/dovo-desktop-gpui" > "$2/gui.log" 2>&1 &
  gui_pid=$!
  trap "kill $gui_pid 2>/dev/null || true; wait $gui_pid 2>/dev/null || true" EXIT
  count=0
  while [ "$count" -lt 60 ]; do
    if ! kill -0 "$gui_pid" 2>/dev/null; then cat "$2/gui.log"; exit 1; fi
    if xdotool search --onlyvisible --class dev.dovo.studio.gpui >/dev/null 2>&1; then
      sleep 3
      kill -0 "$gui_pid" || { cat "$2/gui.log"; exit 1; }
      echo "Native GPUI window opened in the clean distro."
      exit 0
    fi
    count=$((count + 1))
    sleep 1
  done
  cat "$2/gui.log"
  echo "Native GPUI window did not open" >&2
  exit 1
GUI_CHECK
