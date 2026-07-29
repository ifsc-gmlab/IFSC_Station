#!/usr/bin/env bash
# build_IFSC-Station.sh
# Build IFSC-Station on Ubuntu 22.04+ (Linux x86_64).
# Mirror of build/windows/build_IFSC-Station_installer.bat for Linux.
# Output: build/IFSC-Station.AppImage
#
# Required tools (all configurable via env vars, see below):
#   - Qt 5.15.2 for GCC (gcc_64)         QT_DIR
#   - GCC 7+ compiler (g++)              already in PATH
#   - jom (parallel make, optional)      auto-detected
#   - linuxdeployqt (continuous x86_64)  LINUXDEPLOYQT
#   - appimagetool (x86_64)              APPIMAGETOOL
#
# Usage:
#   ./build/linux/build_IFSC-Station.sh                 # use env defaults
#   QT_DIR=/opt/Qt/5.15.2/gcc_64 ./build/linux/build_IFSC-Station.sh
#
# Author: IFSC GMLab

set -euo pipefail

#------------------------- Configuration -------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BUILD_DIR="${SRC_DIR}/build"

# Kit-style intermediate build directory (matches Qt Creator layout)
KIT_NAME="${KIT_NAME:-Desktop_Qt_5_15_2_GCC_64bit_Release}"
APP_BUILD_DIR="${BUILD_DIR}/${KIT_NAME}"

# Output staging directory
STAGING_DIR="${STAGING_DIR:-${APP_BUILD_DIR}/staging}"

# App identity (must match QGC_APPLICATION_NAME in qgroundcontrol.pro)
APP_NAME="IFSC-Station"
ORG_NAME="IFSC-Station"
ORG_DOMAIN="ifsc-station.local"
APP_DESCRIPTION="${APP_DESCRIPTION:-IFSC Station - UAS Ground Control Station}"

# Tool locations (override via env)
QT_DIR="${QT_DIR:-}"
LINUXDEPLOYQT="${LINUXDEPLOYQT:-${HOME}/tools/linuxdeployqt-continuous-x86_64.AppImage}"
APPIMAGETOOL="${APPIMAGETOOL:-${HOME}/tools/appimagetool-x86_64.AppImage}"

# Path to the AppImage icon (PNG, 256x256 or larger; sources: resources/IFSCLogo.png)
APP_ICON_SRC="${APP_ICON_SRC:-${SRC_DIR}/resources/IFSCLogo.png}"
APP_ICON_NAME="IFSC-Station"

#------------------------- Logging helpers -------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { printf "${CYAN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$*"; }
log_ok()    { printf "${GREEN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$*"; }
log_warn()  { printf "${YELLOW}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$*" >&2; }
log_error() { printf "${RED}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$*" >&2; }
hr()        { printf "============================================================\n"; }

#------------------------- Helpers -------------------------
detect_qt() {
    if [ -n "${QT_DIR}" ] && [ -x "${QT_DIR}/bin/qmake" ]; then
        return 0
    fi
    # Common Qt install locations
    local candidates=(
        "/opt/Qt/5.15.2/gcc_64"
        "/opt/Qt/5.15.1/gcc_64"
        "${HOME}/Qt/5.15.2/gcc_64"
        "/usr/lib/qt5"
        "/usr/lib/x86_64-linux-gnu/qt5"
    )
    for cand in "${candidates[@]}"; do
        if [ -x "${cand}/bin/qmake" ]; then
            QT_DIR="${cand}"
            return 0
        fi
    done
    return 1
}

# Download a URL to a target file. Uses wget if available, else curl.
# Returns 0 on success, 1 on failure. Logs the underlying error.
download_file() {
    local url="$1"
    local dst="$2"
    mkdir -p "$(dirname "${dst}")"
    if command -v wget &>/dev/null; then
        if wget -q --show-progress -O "${dst}.part" "${url}" 2> "${dst}.wgeterr"; then
            mv "${dst}.part" "${dst}"
            rm -f "${dst}.wgeterr"
            return 0
        fi
        log_error "  wget failed for ${url}"
        [ -s "${dst}.wgeterr" ] && sed 's/^/    /' "${dst}.wgeterr" >&2
        rm -f "${dst}.part" "${dst}.wgeterr"
        return 1
    elif command -v curl &>/dev/null; then
        if curl -fSL --progress-bar -o "${dst}.part" "${url}" 2> "${dst}.curlerr"; then
            mv "${dst}.part" "${dst}"
            rm -f "${dst}.curlerr"
            return 0
        fi
        log_error "  curl failed for ${url}"
        [ -s "${dst}.curlerr" ] && sed 's/^/    /' "${dst}.curlerr" >&2
        rm -f "${dst}.part" "${dst}.curlerr"
        return 1
    fi
    log_error "  no wget or curl available"
    return 1
}

# Manually extract an AppImage so we can call its inner binary directly.
# Why: linuxdeployqt continuous build >= 100 (2024+) has a strict CLI
# parser that rejects all `--` flags including `--appimage-extract-and-run`,
# so the runtime-extract-and-exec path no longer works. Extracting once
# upfront and reusing the inner binary avoids runtime flag plumbing.
#
# Sets the global variable `EXTRACTED_BIN` to the path of the inner binary
# on success. Caches extraction under $XDG_CACHE_HOME (or ~/.cache).
extract_appimage() {
    local appimage="$1"
    local name="$2"           # e.g. "linuxdeployqt" or "appimagetool"
    local inner_path="$3"     # path inside the squashfs-root, e.g. "usr/bin/linuxdeployqt"

    local cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/ifsc-station-tools"
    local extracted_root="${cache_root}/${name}-extracted"
    local inner_bin="${extracted_root}/${inner_path}"

    if [ -x "${inner_bin}" ]; then
        EXTRACTED_BIN="${inner_bin}"
        return 0
    fi

    log_info "Extracting ${appimage} (one-time) ..."
    local workdir
    workdir="$(mktemp -d)"
    (
        cd "${workdir}"
        # --appimage-extract: extract to ./squashfs-root/ and exit
        "${appimage}" --appimage-extract >/dev/null 2>&1
    )
    if [ ! -d "${workdir}/squashfs-root" ]; then
        log_error "  failed to extract ${appimage}"
        rm -rf "${workdir}"
        return 1
    fi
    mkdir -p "${extracted_root}"
    # Move extracted tree to cache (cross-device safe: cp then rm)
    cp -a "${workdir}/squashfs-root/." "${extracted_root}/"
    rm -rf "${workdir}"

    if [ ! -x "${inner_bin}" ]; then
        log_error "  inner binary not found at ${inner_bin}"
        log_error "  contents of ${extracted_root}:"
        ls -la "${extracted_root}" 2>/dev/null | sed 's/^/    /'
        return 1
    fi
    log_ok "  extracted -> ${inner_bin}"
    EXTRACTED_BIN="${inner_bin}"
    return 0
}

# Self-bootstrap: download linuxdeployqt AppImage if missing.
# Honors LINUXDEPLOYQT env var (override path/URL).
bootstrap_linuxdeployqt() {
    local url="${LINUXDEPLOYQT_URL:-https://github.com/probonopd/linuxdeployqt/releases/download/continuous/linuxdeployqt-continuous-x86_64.AppImage}"
    log_info "Bootstrapping linuxdeployqt from ${url} ..."
    if download_file "${url}" "${LINUXDEPLOYQT}"; then
        chmod +x "${LINUXDEPLOYQT}"
        log_ok "  downloaded -> ${LINUXDEPLOYQT}"
        return 0
    fi
    return 1
}

# Self-bootstrap: download appimagetool AppImage if missing.
# Honors APPIMAGETOOL_URL env var (override URL).
# Note: the legacy repo (AppImage/AppImageKit) is marked obsolete; the
#       active project is now https://github.com/AppImage/appimagetool.
bootstrap_appimagetool() {
    local url="${APPIMAGETOOL_URL:-https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage}"
    log_info "Bootstrapping appimagetool from ${url} ..."
    if download_file "${url}" "${APPIMAGETOOL}"; then
        chmod +x "${APPIMAGETOOL}"
        log_ok "  downloaded -> ${APPIMAGETOOL}"
        return 0
    fi
    return 1
}

# Resolve the actual binary paths we'll invoke. This handles the case
# where the AppImages can't be passed runtime flags (because their inner
# binaries reject `--` arguments in newer builds). We extract them once
# and use the inner binary path for all subsequent calls.
resolve_tool_paths() {
    if ! extract_appimage "${LINUXDEPLOYQT}" "linuxdeployqt" "usr/bin/linuxdeployqt"; then
        log_warn "  extraction failed; falling back to running the AppImage directly"
        log_warn "  (may fail with newer linuxdeployqt that rejects -- flags)"
        LINUXDEPLOYQT_BIN="${LINUXDEPLOYQT}"
    else
        LINUXDEPLOYQT_BIN="${EXTRACTED_BIN}"
    fi
    if ! extract_appimage "${APPIMAGETOOL}" "appimagetool" "usr/bin/appimagetool"; then
        APPIMAGETOOL_BIN="${APPIMAGETOOL}"
    else
        APPIMAGETOOL_BIN="${EXTRACTED_BIN}"
    fi
}

#------------------------- 0. Environment check -------------------------
check_environment() {
    hr
    log_info "Checking build environment..."

    # Qt
    if ! detect_qt; then
        log_error "Qt 5.15.x not found."
        log_error "Set QT_DIR env var, e.g.:"
        log_error "  export QT_DIR=/opt/Qt/5.15.2/gcc_64"
        log_error "Or install via Qt online installer:"
        log_error "  https://www.qt.io/download-qt-installer"
        exit 1
    fi
    log_ok "Qt found: ${QT_DIR}"
    export PATH="${QT_DIR}/bin:${PATH}"

    # GCC
    if ! command -v g++ &>/dev/null; then
        log_error "g++ not found. Install with: sudo apt install build-essential"
        exit 1
    fi
    local gcc_ver
    gcc_ver="$(g++ -dumpversion)"
    log_ok "GCC: $(g++ --version | head -n1)"

    # Make or jom
    if command -v jom &>/dev/null; then
        BUILD_TOOL="jom"
        BUILD_JOBS="$(nproc)"
    else
        BUILD_TOOL="make"
        BUILD_JOBS="-j$(nproc)"
        log_warn "jom not found, using make with $(nproc) jobs"
    fi
    log_ok "Build tool: ${BUILD_TOOL} ${BUILD_JOBS}"

    # linuxdeployqt (self-bootstrap: download if missing)
    if [ ! -x "${LINUXDEPLOYQT}" ]; then
        log_warn "linuxdeployqt not found at: ${LINUXDEPLOYQT}"
        if ! bootstrap_linuxdeployqt; then
            log_error "Failed to bootstrap linuxdeployqt."
            log_error "Either install manually, or set LINUXDEPLOYQT env var."
            log_error "  export LINUXDEPLOYQT=/path/to/linuxdeployqt-continuous-x86_64.AppImage"
            exit 1
        fi
    fi
    log_ok "linuxdeployqt: ${LINUXDEPLOYQT}"

    # appimagetool (self-bootstrap: download if missing)
    if [ ! -x "${APPIMAGETOOL}" ]; then
        log_warn "appimagetool not found at: ${APPIMAGETOOL}"
        if ! bootstrap_appimagetool; then
            log_error "Failed to bootstrap appimagetool."
            log_error "Either install manually, or set APPIMAGETOOL env var."
            log_error "  export APPIMAGETOOL=/path/to/appimagetool-x86_64.AppImage"
            exit 1
        fi
    fi
    log_ok "appimagetool: ${APPIMAGETOOL}"

    # Required runtime tools for the AppImages themselves
    if ! command -v wget &>/dev/null && ! command -v curl &>/dev/null; then
        log_error "wget or curl is required to bootstrap tools."
        log_error "Install with: sudo apt install wget curl"
        exit 1
    fi
    if ! command -v file &>/dev/null; then
        log_warn "'file' command not found; install with: sudo apt install file"
    fi
    if ! command -v zsync &>/dev/null; then
        log_warn "'zsync' not found (appimagetool needs it for updates);"
        log_warn "  install with: sudo apt install zsync"
    fi
    # linuxdeployqt's runtime + AppImage runtime tools
    if ! command -v patchelf &>/dev/null; then
        log_warn "'patchelf' not found; install with: sudo apt install patchelf"
        log_warn "  (required by deploy/linux-fixup-rpaths.bash)"
    fi
    if ! command -v readelf &>/dev/null; then
        log_warn "'readelf' not found; install with: sudo apt install binutils"
        log_warn "  (required by deploy/linux-fixup-rpaths.bash)"
    fi
    if ! command -v desktop-file-install &>/dev/null; then
        log_warn "'desktop-file-install' not found; install with: sudo apt install desktop-file-utils"
    fi

    # Now that we have the AppImages, extract their inner binaries so we
    # can call them directly (avoids the AppImage runtime's strict
    # argument parser that breaks the linuxdeployqt call).
    resolve_tool_paths
    log_ok "linuxdeployqt (extracted): ${LINUXDEPLOYQT_BIN}"
    log_ok "appimagetool  (extracted): ${APPIMAGETOOL_BIN}"

    # App icon
    if [ ! -f "${APP_ICON_SRC}" ]; then
        log_warn "App icon not found at ${APP_ICON_SRC}"
        log_warn "AppImage will use a generic icon."
        APP_ICON_SRC=""
    fi

    # Summary
    hr
    log_info "Project root : ${SRC_DIR}"
    log_info "Build dir    : ${APP_BUILD_DIR}"
    log_info "Staging dir  : ${STAGING_DIR}"
    log_info "Qt           : ${QT_DIR}"
    log_info "Compiler     : g++ ${gcc_ver}"
    log_info "Build tool   : ${BUILD_TOOL} ${BUILD_JOBS}"
    log_info "App          : ${APP_NAME} (${ORG_NAME})"
    hr
}

#------------------------- 1. Strip UTF-8 BOMs from critical files -------------------------
strip_boms() {
    log_info "[1/8] Stripping UTF-8 BOMs from critical .cc/.h files..."
    local stripped=0
    local files=(
        "${SRC_DIR}/src/QGCApplication.cc"
        "${SRC_DIR}/src/Settings/AppSettings.cc"
        "${SRC_DIR}/src/main.cc"
        "${SRC_DIR}/src/QGCApplication.h"
        "${SRC_DIR}/src/comm/LogReplayLink.h"
    )
    for f in "${files[@]}"; do
        if [ -f "${f}" ]; then
            # If first 3 bytes are EF BB BF, strip them
            if head -c 3 "${f}" | xxd -p | grep -qi '^efbbbf'; then
                tail -c +4 "${f}" > "${f}.nobom" && mv "${f}.nobom" "${f}"
                log_ok "  stripped BOM: ${f}"
                stripped=$((stripped + 1))
            fi
        fi
    done
    if [ "${stripped}" -eq 0 ]; then
        log_ok "  no BOMs found in critical files"
    fi
}

#------------------------- 1b. Strip CRLF line endings from scripts -------------------------
# Why: deploy/linux-fixup-rpaths.bash and other shell scripts are stored
# on Windows (in the source tree). When packaged via Windows tar and
# extracted on Linux, the CRLF (\r\n) line endings are preserved, which
# makes the shebang `#!/usr/bin/env bash\r` unparseable on Linux:
#   /usr/bin/env: 'bash\r': No such file or directory
# This step normalizes all *.sh / *.bash files in the source tree to LF
# and restores the executable bit (Windows tar also loses +x).
strip_crlf_and_chmod() {
    log_info "[1b/8] Stripping CRLF line endings from .sh/.bash scripts..."
    local fixed=0
    local chmoded=0
    # Build list of script files (deploy/ + build/)
    local files=()
    while IFS= read -r -d '' f; do
        files+=("${f}")
    done < <(find "${SRC_DIR}/deploy" "${SRC_DIR}/build" \
                 -type f \( -name '*.sh' -o -name '*.bash' \) \
                 -print0 2>/dev/null)
    for f in "${files[@]}"; do
        # Check if file has any CR (\r) byte
        if grep -q $'\r' "${f}" 2>/dev/null; then
            # Strip trailing \r on each line: sed -i 's/\r$//' is portable enough
            sed -i 's/\r$//' "${f}"
            log_ok "  stripped CRLF: ${f#${SRC_DIR}/}"
            fixed=$((fixed + 1))
        fi
        if [ ! -x "${f}" ]; then
            chmod +x "${f}"
            chmoded=$((chmoded + 1))
        fi
    done
    if [ "${fixed}" -eq 0 ] && [ "${chmoded}" -eq 0 ]; then
        log_ok "  all scripts already LF + executable"
    else
        log_ok "  CRLF fixed: ${fixed}, +x added: ${chmoded}"
    fi
}

#------------------------- 2. Clean intermediate build files -------------------------
clean_intermediates() {
    log_info "[2/8] Cleaning stale build artifacts (PCH, .o, .obj, .qrc, etc.)..."
    if [ ! -d "${APP_BUILD_DIR}" ]; then
        log_ok "  no previous build, skipping"
        return
    fi
    # Patterns to clean (all of these are regenerable)
    find "${APP_BUILD_DIR}" \
        \( -name '*.o' -o -name '*.obj' \
           -o -name '*.pch' -o -name '*.pdb' \
           -o -name '*.res' -o -name '*.rcc' -o -name '*.idb' \
           -o -name '*.exp' -o -name '*.lib' -o -name '*.ilk' \
           -o -name 'moc_*.cpp' -o -name 'moc_*.h' \
           -o -name 'ui_*.h' \
           -o -name 'qrc_*.cpp' \
           -o -name 'Makefile*' \
           -o -name '.qmake.stash' \
        \) -type f -delete 2>/dev/null || true
    log_ok "  cleaned"
}

#------------------------- 3. qmake configure -------------------------
qmake_configure() {
    log_info "[3/8] qmake configure..."
    mkdir -p "${APP_BUILD_DIR}"
    cd "${APP_BUILD_DIR}"
    "${QT_DIR}/bin/qmake" CONFIG+=release CONFIG+=WarningsAsErrorsOn \
        "${SRC_DIR}/qgroundcontrol.pro" 2>&1 | tail -20
    log_ok "qmake done"
    cd "${SRC_DIR}"
}

#------------------------- 4. Compile (make/jom) -------------------------
compile() {
    log_info "[4/8] Compiling (this can take 20-40 minutes on first run)..."
    cd "${APP_BUILD_DIR}"
    if [ "${BUILD_TOOL}" = "jom" ]; then
        jom ${BUILD_JOBS} 2>&1 | tail -100
    else
        make ${BUILD_JOBS} 2>&1 | tail -100
    fi
    log_ok "compile done"
    cd "${SRC_DIR}"
}

#------------------------- 5. Fix rpaths (using upstream script) -------------------------
fix_rpaths() {
    log_info "[5/8] Fixing library rpaths..."
    if [ ! -f "${STAGING_DIR}/${APP_NAME}" ]; then
        log_warn "  binary not found at ${STAGING_DIR}/${APP_NAME}, skipping rpath fix"
        return 0
    fi
    if [ ! -f "${SRC_DIR}/deploy/linux-fixup-rpaths.bash" ]; then
        log_warn "  deploy/linux-fixup-rpaths.bash not found, skipping"
        return 0
    fi

    # The upstream script uses `set -euo pipefail` and exits 1 on the first
    # failure. Capture exit code explicitly so we surface a useful error
    # instead of silently dying. Also pass absolute paths for SEARCHDIR /
    # RPATHDIR (the script defaults to "./Qt" / "./Qt/libs" which depend on
    # cwd and won't resolve from this script's invocation dir).
    local searchdir="${STAGING_DIR}/Qt"
    local rpathdir="${STAGING_DIR}/Qt/libs"
    log_info "  SEARCHDIR=${searchdir}"
    log_info "  RPATHDIR=${rpathdir}"

    if [ ! -d "${searchdir}" ]; then
        log_error "  staging/Qt/ not found at ${searchdir}"
        log_error "  The QMAKE_POST_LINK step in Qt Creator should have created it;"
        log_error "  if it didn't, do a Clean + Rebuild in Qt Creator."
        return 1
    fi

    # Sanity check: linux-fixup-rpaths.bash requires `patchelf` and `readelf`.
    local missing=()
    command -v patchelf &>/dev/null || missing+=("patchelf")
    command -v readelf  &>/dev/null || missing+=("readelf")
    if [ "${#missing[@]}" -gt 0 ]; then
        log_error "  missing required tools: ${missing[*]}"
        log_error "  install with: sudo apt install ${missing[*]}"
        return 1
    fi

    # Run the upstream script with absolute paths, capture all output.
    if SEARCHDIR="${searchdir}" RPATHDIR="${rpathdir}" \
        bash "${SRC_DIR}/deploy/linux-fixup-rpaths.bash"; then
        log_ok "rpaths fixed"
        return 0
    else
        local rc=$?
        log_error "  linux-fixup-rpaths.bash failed (exit ${rc})"
        log_error "  run it manually for the full trace:"
        log_error "    SEARCHDIR=${searchdir} RPATHDIR=${rpathdir} \\"
        log_error "      bash ${SRC_DIR}/deploy/linux-fixup-rpaths.bash"
        return ${rc}
    fi
}

#------------------------- 6. Create AppImage (using linuxdeployqt) -------------------------
create_appimage() {
    log_info "[6/8] Creating AppImage..."
    local binary_path="${STAGING_DIR}/${APP_NAME}"
    if [ ! -f "${binary_path}" ]; then
        log_error "binary not found: ${binary_path}"
        log_error "compile step must produce the binary first"
        exit 1
    fi

    # Prepare AppDir
    local appdir="${APP_BUILD_DIR}/AppDir"
    rm -rf "${appdir}"
    mkdir -p "${appdir}"

    # Copy icon if available
    if [ -n "${APP_ICON_SRC}" ] && [ -f "${APP_ICON_SRC}" ]; then
        cp "${APP_ICON_SRC}" "${appdir}/${APP_ICON_NAME}.png"
        log_ok "  icon: ${APP_ICON_NAME}.png"
    fi

    # Generate .desktop file (this fixes the upstream heredoc bug)
    cat > "${appdir}/${APP_NAME}.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
GenericName=Ground Control Station
Comment=${APP_DESCRIPTION}
Icon=${APP_ICON_NAME}
Exec=AppRun
Terminal=false
Categories=Utility;Development;
Keywords=UAV;Drone;MAVLink;
EOF
    log_ok "  .desktop file generated"

    #-------------------------------------------------------------------
    # Bundle Qt/QML/plugins into the AppDir.
    #
    # We do NOT use linuxdeployqt here because the current "continuous"
    # build (>= 100, Qt6 era) has a completely rewritten CLI that
    # removed `-appdir=`, `-executable=`, `-desktopfile=`, and rejects
    # all `--` flags. Working around that rabbit hole isn't worth the
    # time. Instead we copy Qt/QML/plugins that Qt Creator's
    # QMAKE_POST_LINK already staged into ${STAGING_DIR}/Qt/ into the
    # AppDir, set the right rpaths/Env, and let appimagetool do the
    # final squashfs step. This is the same end result.
    #-------------------------------------------------------------------
    log_info "  bundling Qt runtime into AppDir (no linuxdeployqt)..."
    local qt_staging="${STAGING_DIR}/Qt"
    if [ ! -d "${qt_staging}" ]; then
        log_error "  ${qt_staging} not found."
        log_error "  Qt Creator's Post Link step should have populated it."
        log_error "  In Qt Creator: Build -> Run Build Steps -> enable 'Post Link' or Rebuild."
        exit 1
    fi

    local usr="${appdir}/usr"
    mkdir -p "${usr}/bin" "${usr}/lib" "${usr}/qml" "${usr}/plugins" "${usr}/libexec"

    # 1. The binary
    cp "${binary_path}" "${usr}/bin/${APP_NAME}"
    # Make sure it's executable
    chmod +x "${usr}/bin/${APP_NAME}"

    # 2. Qt libraries
    #    ${qt_staging}/libs/ contains libQt5*.so* and friends.
    #    `-P` preserves symlinks; Qt ships many libfoo.so.N -> libfoo.so.N.M chains.
    if [ -d "${qt_staging}/libs" ]; then
        cp -P "${qt_staging}/libs/."* "${usr}/lib/" 2>/dev/null || \
        cp -P "${qt_staging}/libs/"* "${usr}/lib/"
    else
        log_warn "  ${qt_staging}/libs not found; continuing without bundled libs"
    fi

    # 3. QML modules
    if [ -d "${qt_staging}/qml" ]; then
        cp -r "${qt_staging}/qml/." "${usr}/qml/"
    else
        log_warn "  ${qt_staging}/qml not found; QML scenes may not load"
    fi

    # 4. Qt plugins (platforms, imageformats, xcbglintegrations, etc.)
    #    Layout under ${qt_staging}/plugins/ mirrors ${usr}/plugins/ so a
    #    direct recursive copy is enough.
    if [ -d "${qt_staging}/plugins" ]; then
        cp -r "${qt_staging}/plugins/." "${usr}/plugins/"
    else
        log_warn "  ${qt_staging}/plugins not found; some plugins may be missing"
    fi

    # 5. Anything else Qt Creator copied (libexec, qmltooling, etc.)
    for sub in libexec qmltooling translations; do
        if [ -d "${qt_staging}/${sub}" ]; then
            cp -r "${qt_staging}/${sub}" "${usr}/"
        fi
    done

    # 6. Set rpath on the binary so it finds the bundled libs at runtime
    if command -v patchelf &>/dev/null; then
        patchelf --set-rpath '$ORIGIN/../lib' "${usr}/bin/${APP_NAME}" || \
            log_warn "  patchelf failed on binary; will rely on LD_LIBRARY_PATH"
    else
        log_warn "  patchelf missing; relying on LD_LIBRARY_PATH in AppRun"
    fi

    # 7. AppRun: standard AppImage launcher.
    #    Sets up all the search paths Qt needs (LD_LIBRARY_PATH,
    #    QML2_IMPORT_PATH, QT_PLUGIN_PATH) then execs the binary.
    cat > "${appdir}/AppRun" <<'APPRUN_EOF'
#!/bin/sh
# AppRun: IFSC-Station launcher inside the AppImage
HERE="$(dirname "$(readlink -f "${0}")")"
export LD_LIBRARY_PATH="${HERE}/usr/lib:${HERE}/usr/libexec:${LD_LIBRARY_PATH}"
export QML2_IMPORT_PATH="${HERE}/usr/qml:${QML2_IMPORT_PATH}"
export QT_PLUGIN_PATH="${HERE}/usr/plugins:${QT_PLUGIN_PATH}"
export QT_QPA_PLATFORM_PLUGIN_PATH="${HERE}/usr/plugins/platforms"
export QT_FONT_DPI="${QT_FONT_DPI:-96}"
# Hack: also place the icon in ~/.icons so old file managers / GTK
# themes can find it (some desktops don't honour .DirIcon for AppImages).
mkdir -p "${HOME}/.icons"
cp -f "${HERE}/IFSC-Station.png" "${HOME}/.icons/" 2>/dev/null || true
exec "${HERE}/usr/bin/IFSC-Station" "$@"
APPRUN_EOF
    chmod +x "${appdir}/AppRun"

    # 8. .DirIcon -> .png so file managers display the icon
    (cd "${appdir}" && ln -sf "${APP_ICON_NAME}.png" .DirIcon)

    log_ok "  AppDir ready: $(du -sh "${appdir}" | cut -f1)"

    # Build the AppImage (use the extracted inner binary; see above for rationale)
    log_info "  running appimagetool..."
    local output_image="${BUILD_DIR}/${APP_NAME}-${KIT_NAME##*_}.AppImage"
    rm -f "${output_image}"
    cd "${APP_BUILD_DIR}"
    "${APPIMAGETOOL_BIN}" "${appdir}" "${output_image}" 2>&1 | tail -10
    cd "${SRC_DIR}"

    if [ -f "${output_image}" ]; then
        log_ok "  AppImage created: ${output_image}"
    else
        log_error "  AppImage creation failed"
        exit 1
    fi
}

#------------------------- 7. Verify final artifacts -------------------------
verify_artifacts() {
    log_info "[7/8] Verifying artifacts..."
    local appimage="${BUILD_DIR}/${APP_NAME}-${KIT_NAME##*_}.AppImage"
    if [ ! -f "${appimage}" ]; then
        log_error "AppImage not found: ${appimage}"
        exit 1
    fi
    local size_mb
    size_mb="$(du -m "${appimage}" | cut -f1)"
    log_ok "AppImage: ${appimage} (${size_mb} MB)"

    # Make executable (in case it lost the bit)
    chmod +x "${appimage}"

    # Show final summary
    hr
    log_ok "==========================================="
    log_ok "  IFSC-Station Linux build complete!"
    log_ok "  Output: ${appimage}"
    log_ok "  Run:    ${appimage}"
    log_ok "==========================================="
    hr
}

#------------------------- Main -------------------------
main() {
    # 0. Cross-platform fixups FIRST (run unconditionally; no tool deps).
    #    These are safe to run even if Qt/linuxdeployqt/appimagetool
    #    are not installed, so SKIP_BUILD=1 still works for normalization.
    strip_boms
    strip_crlf_and_chmod

    # If SKIP_BUILD=1, stop here after fixups.
    # This is useful when the user just wants to repair CRLF/BOM on the
    # extracted source tree and does the actual build via Qt Creator.
    if [ "${SKIP_BUILD:-0}" = "1" ]; then
        hr
        log_ok "SKIP_BUILD=1 set: stopped after CRLF/BOM fixups."
        log_ok "You can now build with Qt Creator (Build -> Rebuild)."
        hr
        return 0
    fi

    # 1. Environment check (only if we'll actually build/package).
    check_environment

    # 2a. Compile steps (skipped if SKIP_COMPILE=1, e.g. user already
    #     built via Qt Creator and just wants to package the AppImage).
    if [ "${SKIP_COMPILE:-0}" = "1" ]; then
        log_info "SKIP_COMPILE=1 set: skipping clean/qmake/compile."
        # Sanity check: the binary must exist where STAGING_DIR says.
        if [ ! -f "${STAGING_DIR}/${APP_NAME}" ]; then
            log_error "SKIP_COMPILE=1 but binary not found: ${STAGING_DIR}/${APP_NAME}"
            log_error "Did you Build (not just configure) in Qt Creator?"
            exit 1
        fi
        log_ok "  found binary: ${STAGING_DIR}/${APP_NAME}"
    else
        clean_intermediates
        qmake_configure
        compile
    fi

    # 2b. Package steps (always run; can be skipped with SKIP_PACKAGE=1)
    if [ "${SKIP_PACKAGE:-0}" = "1" ]; then
        log_info "SKIP_PACKAGE=1 set: skipping rpath fix and AppImage creation."
        return 0
    fi
    fix_rpaths
    create_appimage
    verify_artifacts
}

main "$@"
