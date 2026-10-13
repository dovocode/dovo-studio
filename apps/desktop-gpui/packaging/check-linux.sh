#!/bin/sh
set -eu
package_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
exec "$package_directory/libexec/node" "$package_directory/check-linux.mjs" "$@"
