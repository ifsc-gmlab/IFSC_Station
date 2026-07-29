#!/usr/bin/env bash
# strip_bom.sh
# Strip UTF-8 BOMs (EF BB BF) from critical .cc/.h files that fail to compile
# when BOMs are present (MSVC's /source-charset can't handle stacked BOMs, and
# some editors add BOMs on save). This script is auto-called by
# build_IFSC-Station.sh on every build, so BOMs added by editor are auto-cleaned.
#
# Usage: ./build/linux/strip_bom.sh [FILE] ...
#        (no args: strip from known critical files)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Default critical files
DEFAULT_FILES=(
    "${SRC_DIR}/src/QGCApplication.cc"
    "${SRC_DIR}/src/Settings/AppSettings.cc"
    "${SRC_DIR}/src/main.cc"
    "${SRC_DIR}/src/QGCApplication.h"
    "${SRC_DIR}/src/comm/LogReplayLink.h"
)

if [ $# -eq 0 ]; then
    FILES=("${DEFAULT_FILES[@]}")
else
    FILES=("$@")
fi

strip_one() {
    local f="$1"
    if [ ! -f "${f}" ]; then
        return 0
    fi
    # First 3 bytes in hex
    local first3
    first3="$(head -c 3 "${f}" | xxd -p | tr -d '\n' | tr '[:upper:]' '[:lower:]')"
    if [ "${first3}" = "efbbbf" ]; then
        # Strip first 3 bytes
        tail -c +4 "${f}" > "${f}.nobom"
        mv "${f}.nobom" "${f}"
        echo "stripped BOM: ${f}"
    fi
}

for f in "${FILES[@]}"; do
    strip_one "${f}"
done
