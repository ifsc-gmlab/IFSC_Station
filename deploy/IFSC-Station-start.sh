#!/bin/sh
# IFSC Station 启动脚本（AppRun）
# 与官方 QGroundControl 完全一致的简单方案：
#   1. setWindowIcon(ico) 已经在 main.cc 里设置 _NET_WM_ICON
#   2. 标题栏 / Alt-Tab / Activities 概览会从 .desktop 的 Icon= 字段查找
#   3. AppImage 根的 .png 通过本脚本复制到 ~/.icons/ 兼容旧 KDE/GNOME
HERE="$(dirname "$(readlink -f "${0}")")"

# IFSC Station: 把 128x128 PNG 复制到用户级图标目录（与官方 QGC 做法一致）
mkdir -p "${HOME}/.icons" && cp "${HERE}/IFSC-Station.png" "${HOME}/.icons/IFSC-Station.png"

# Qt / QML 运行时环境
export QML2_IMPORT_PATH="${HERE}/Qt/qml"
export LD_LIBRARY_PATH="${HERE}/Qt/libs:${LD_LIBRARY_PATH}"
export QT_PLUGIN_PATH="${HERE}/Qt/plugins"
export QT_QPA_PLATFORM_PLUGIN_PATH="${HERE}/Qt/plugins/platforms"
export QML_IMPORT_NAME=qml

# 启动应用
exec "${HERE}/IFSC-Station" "$@"
