#!/bin/sh
# IFSC-Station-start.sh - AppRun equivalent for IFSC-Station AppImage.
# This file is renamed to "AppRun" inside the AppDir and called when the user
# double-clicks the AppImage or runs it from the command line.

HERE="$(dirname "$(readlink -f "${0}")")"

# Install icon to user icon directory (workaround for AppImage icon visibility)
mkdir -p "${HOME}/.icons" && cp "${HERE}/IFSC-Station.png" "${HOME}/.icons/" 2>/dev/null

# Run the actual binary
"${HERE}/IFSC-Station" "$@"
