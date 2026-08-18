# IFSC-Station 安装与运行手册

> 适用版本：**IFSC-Station V1.0**（基于 QGC 4.2.8 定制）。
> 适用平台：**Ubuntu 20.04 LTS 及以上**（推荐 24.04），x86_64 架构。
> 阅读对象：第一次在干净机器上部署 IFSC-Station 的工程师 / 操作员。

本文档配套 [IFSC_Station_使用手册](IFSC_Station_使用手册.md)（操作步骤） / [IFSC_Station_测试手册](IFSC_Station_测试手册.md)（验证方法）。

---

## 0. 目录

1. [原理：AppImage 的双层依赖](#1-原理appimage-的双层依赖)
2. [硬件与系统要求](#2-硬件与系统要求)
3. [在干净 Ubuntu 20.04+ 上安装](#3-在干净-ubuntu-2004-上安装)
4. [启动 AppImage](#4-启动-appimage)
5. [可选：桌面集成（应用菜单 + 文件类型关联）](#5-可选桌面集成应用菜单--文件类型关联)
6. [验证安装结果](#6-验证安装结果)
7. [故障排除：依赖补齐](#7-故障排除依赖补齐)
8. [卸载](#8-卸载)
9. [常见安装错误速查](#9-常见安装错误速查)
10. [无 FUSE 环境的替代方案](#10-无-fuse-环境的替代方案)

---

## 1. 原理：AppImage 的双层依赖

`IFSC-Station.AppImage` 是 **自包含的可执行文件**，但**仅打包部分**运行时依赖：

| 依赖类型 | 是否打包 | 说明 |
|---|---|---|
| Qt 5.15 运行时（`libQt5Core/Gui/Widgets/Qml/...`） | ❌ **不打包** | 依赖系统 Qt 5，Ubuntu 20.04+ 默认 Qt 5.12，需手动补到 Qt 5.15 |
| SDL2 / directfb | ✅ 打包（`libsdl2-2.0-0`、`libdirectfb-1.2-9`） | 已在 AppDir 内 `usr/lib/...` |
| FUSE 库 | ❌ **不打包** | 依赖系统 `libfuse2`（AppImage 启动时需挂载） |
| GStreamer | ❌ **不打包** | 视频流功能依赖系统 GStreamer 1.0 |
| OpenGL / X11 | ❌ **不打包** | 依赖系统 Mesa / X11 |
| 串口驱动 | ❌ **不打包** | 内核模块（`cdc_acm` / `ftdi_sio`），Ubuntu 默认已带 |

因此，**AppImage 不是"双击即用"**——必须先补齐上述 3 类系统依赖。

---

## 2. 硬件与系统要求

### 2.1 硬件

| 项目 | 最低 | 推荐 |
|---|---|---|
| CPU | x86_64 双核 | x86_64 四核 |
| 内存 | 4 GB | 8 GB |
| 硬盘 | 1 GB 可用 | 2 GB 可用 |
| USB | USB-A × 1 | USB 3.0 × 1（连飞控用） |
| 显示 | 1366×768 | 1920×1080 + |

### 2.2 系统

- **OS**：Ubuntu 20.04 LTS / 22.04 LTS / 24.04 LTS（任一）
- **架构**：x86_64（amd64）
- **桌面环境**：GNOME / KDE / Xfce 均可（GNOME 测试最完整）
- **网络**：首次安装需要联网（拉取依赖 + 离线地图可选）

### 2.3 用户权限

- 当前用户需 `sudo` 权限（用于安装依赖、加 dialout 组）
- 部署完成后需要**重新登录**（dialout 组权限生效）

---

## 3. 在干净 Ubuntu 20.04+ 上安装

> 以下命令在**全新安装的 Ubuntu 20.04 / 22.04 / 24.04** 上验证通过。所有命令以普通用户执行，需要 `sudo` 的步骤已明确标注。

### 3.1 系统更新

```bash
sudo apt update
sudo apt upgrade -y
```

### 3.2 串口权限：把当前用户加入 `dialout` 组

**作用**：让普通用户能读写 `/dev/ttyACM0`、`/dev/ttyUSB0` 等飞控串口（默认只有 root 与 dialout 组能访问）。

```bash
sudo usermod -a -G dialout $USER
```

> ⚠️ **关键步骤**：此命令**不会立即生效**，必须**注销并重新登录**（或重启）。如果跳过这一步，后续 `dialout` 权限相关的连接都会失败。

### 3.3 移除 `modemmanager`（避免串口冲突）

**作用**：Ubuntu 默认安装的 `modemmanager` 会在飞控插入 USB 时"抢占"串口，导致 `QGroundControl` 无法独占 `/dev/ttyACM0`。

```bash
sudo apt remove -y modemmanager
```

> 上游 QGC 官方文档明确要求此步。我们 IFSC-Station 与上游完全同构，因此同样需要。

### 3.4 安装 FUSE 2

**作用**：AppImage 启动时通过 FUSE 把内部的 squashfs 挂载到 `/tmp/.mount_xxxxx/`。Ubuntu 22.04+ 默认已不预装 `libfuse2`，需要手动安装。

```bash
sudo apt install -y libfuse2
```

### 3.5 安装 Qt 5 GUI 库

**作用**：AppImage 不带 Qt 运行时，需依赖系统 Qt 5.12+。Ubuntu 20.04 默认 Qt 5.12 兼容，22.04 是 Qt 5.15，24.04 是 Qt 5.15。`libqt5gui5` 包含核心 QPainter / 字体支持，缺它 AppImage 启动会报 "cannot load Qt platform plugin xcb"。

```bash
sudo apt install -y libqt5gui5
```

> 上游 QGC 官方文档只要求安装 `libqt5gui5`，但实测还需要 Qt 5 的其它几个包（特别是 `qtdeclarative5-qtquick2-plugin`），下面一并安装。

### 3.6 安装 GStreamer 1.0 插件

**作用**：视频流（UDP / RTSP）依赖。**如果只用 IFSC-Station 操控飞行、不看视频，可以跳过本步**。

```bash
sudo apt install -y gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-gl
```

### 3.7 安装其它 Qt 5 依赖（完整列表）

为了一次性补齐所有 QGC 运行时依赖（避免启动后报"X 库缺失"），执行：

```bash
sudo apt install -y \
    libqt5charts5 \
    libqt5network5 \
    libqt5serialport5 \
    libqt5positioning5 \
    libqt5qml5 \
    libqt5quick5 \
    libqt5widgets5 \
    libqt5core5a \
    libqt5multimedia5 \
    libqt5multimediaquick5 \
    libqt5location5 \
    libqt5sensors5 \
    libqt5webchannel5 \
    qtdeclarative5-qtquick2-plugin \
    qml-module-qtquick2 \
    qml-module-qtquick-window2 \
    qml-module-qtqml-models2 \
    qml-module-qt-labs-folderlistmodel \
    qml-module-qt-labs-settings \
    qml-module-qtgraphicaleffects
```

> 各 Ubuntu 版本包名略有差异。如果某条 `apt install` 报"无法定位软件包"，把对应行单独执行并跳过即可（一般 Ubuntu 24.04 不会出现此问题）。

### 3.8 安装图形 / X11 库

```bash
sudo apt install -y \
    libgl1 libglx0 libegl1 libgles2 \
    libxcb-cursor0 libxkbcommon-x11-0 libxkbcommon0 \
    libxcb-xinerama0 libxcb-xinput0 libxcb-randr0 \
    libxcb-render0 libxcb-render-util0 libxcb-shape0 \
    libxcb-shm0 libxcb-sync0 libxcb-xfixes0 libxcb-xkb1 \
    libxcb-image0 libxcb-keysyms1 \
    libfontconfig1 libfreetype6 libdbus-1-3
```

### 3.9 完整一键脚本

把 3.1-3.8 合并成一个脚本 `install_deps.sh`：

```bash
#!/bin/bash
# IFSC-Station 一键依赖安装脚本
# 用法: sudo bash install_deps.sh
set -e

echo "==== 1/8 更新源 ===="
apt update
apt upgrade -y

echo "==== 2/8 加入 dialout 组 ===="
usermod -a -G dialout $SUDO_USER
echo "✓ 当前用户 $SUDO_USER 已加入 dialout（需重新登录生效）"

echo "==== 3/8 移除 modemmanager ===="
apt remove -y modemmanager || true

echo "==== 4/8 安装 FUSE ===="
apt install -y libfuse2

echo "==== 5/8 安装 Qt5 GUI ===="
apt install -y libqt5gui5

echo "==== 6/8 安装 GStreamer ===="
apt install -y gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-gl

echo "==== 7/8 安装 Qt5 全套 ===="
apt install -y \
    libqt5charts5 libqt5network5 libqt5serialport5 libqt5positioning5 \
    libqt5qml5 libqt5quick5 libqt5widgets5 libqt5core5a \
    libqt5multimedia5 libqt5multimediaquick5 libqt5location5 \
    libqt5sensors5 libqt5webchannel5 qtdeclarative5-qtquick2-plugin

echo "==== 8/8 安装图形 / X11 库 ===="
apt install -y \
    libgl1 libglx0 libegl1 libgles2 \
    libxcb-cursor0 libxkbcommon-x11-0 libxkbcommon0 \
    libxcb-xinerama0 libxcb-xinput0 libxcb-randr0 \
    libxcb-render0 libxcb-render-util0 libxcb-shape0 \
    libxcb-shm0 libxcb-sync0 libxcb-xfixes0 libxcb-xkb1 \
    libxcb-image0 libxcb-keysyms1 \
    libfontconfig1 libfreetype6 libdbus-1-3

echo ""
echo "==== 安装完成 ===="
echo "⚠️  请重新登录（注销 → 登录），使 dialout 组权限生效"
echo "⚠️  重新登录后运行：./IFSC-Station.AppImage"
```

执行：

```bash
chmod +x install_deps.sh
sudo bash install_deps.sh
```

> **执行后必须重新登录**。

### 3.10 赋予 AppImage 执行权限

```bash
chmod +x IFSC-Station.AppImage
```

---

## 4. 启动 AppImage

### 4.1 首次启动

```bash
./IFSC-Station.AppImage
```

> 首次启动会自动：
> 1. 用 FUSE 把内部 squashfs 挂载到 `/tmp/.mount_IFSC-XXXX/`
> 2. 把 `IFSC-Station.png` 复制到 `~/.icons/`（任务栏图标需要）
> 3. 创建用户配置目录 `~/.config/QGroundControl.org/IFSC Station.ini`

如果终端没有打印任何错误，5-10 秒后会弹出主窗口。

### 4.2 后续启动

可以直接双击文件管理器中的 `IFSC-Station.AppImage`，或继续在终端运行 `./IFSC-Station.AppImage`。

### 4.3 验证启动成功

```bash
# 方式 1：终端启动后看日志
./IFSC-Station.AppImage
# 期望看到 "Settings location ... Is writable? true"

# 方式 2：检查进程
pgrep -af IFSC-Station
```

### 4.4 退出

主窗口关闭按钮 / `Ctrl+Q` / 任务栏右键 → Quit。

---

## 5. 可选：桌面集成（应用菜单 + 文件类型关联）

> 这一步让 AppImage 像普通应用一样出现在 GNOME Activities / KDE 启动器中，可以搜索 "IFSC Station" 启动。

### 5.1 移动 AppImage 到固定位置

```bash
sudo mkdir -p /opt/ifsc-station
sudo cp IFSC-Station.AppImage /opt/ifsc-station/
sudo chmod +x /opt/ifsc-station/IFSC-Station.AppImage
```

### 5.2 创建 .desktop 文件

```bash
sudo tee /usr/local/share/applications/ifsc-station.desktop <<'EOF'
[Desktop Entry]
Type=Application
Name=IFSC Station
GenericName=Ground Control Station
Comment=UAS ground control station
Icon=IFSC-Station
Exec=/opt/ifsc-station/IFSC-Station.AppImage %F
Terminal=false
Categories=Utility;Engineering;Geography;
Keywords=drone;uav;quadcopter;pixhawk;ardupilot;ros;computer;
StartupNotify=true
StartupWMClass=IFSC-Station
MimeType=application/x-IFSC-Station;
EOF
```

```bash
sudo update-desktop-database
```

### 5.3 复制图标到 hicolor 主题

```bash
# 解包 AppImage 拿到内部 PNG 图标
mkdir -p /tmp/ifsc-extract
cd /tmp/ifsc-extract
/opt/ifsc-station/IFSC-Station.AppImage --appimage-extract

# 把 PNG 复制到多尺寸 hicolor 路径
for size in 16 22 24 32 48 64 96 128 256 512; do
    sudo mkdir -p /usr/share/icons/hicolor/${size}x${size}/apps
    sudo cp /tmp/ifsc-extract/squashfs-root/IFSC-Station.png \
             /usr/share/icons/hicolor/${size}x${size}/apps/IFSC-Station.png
done

# 刷新图标缓存
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor
```

### 5.4 验证桌面集成

```bash
# 1. 验证 .desktop 文件可被 desktop-file-validate 识别
desktop-file-validate /usr/local/share/applications/ifsc-station.desktop

# 2. 验证图标在所有尺寸都存在
ls /usr/share/icons/hicolor/*/apps/IFSC-Station.png

# 3. 在 GNOME Activities 中搜索 "IFSC Station"
# 4. 在 KDE 启动器中搜索 "IFSC Station"
```

### 5.5 启动器搜索不到？

按 `Alt+F2` 输入 `r` 重启 GNOME Shell（或重新登录一次）。KDE 不需要这步。

---

## 6. 验证安装结果

### 6.1 系统依赖验证

```bash
# 1. FUSE 已安装
dpkg -l libfuse2 | tail -1

# 2. Qt 5 GUI 已安装
dpkg -l libqt5gui5 | tail -1

# 3. 用户在 dialout 组
groups | grep dialout
# 期望看到: ... dialout ...

# 4. FUSE 模块可加载
ls -l /dev/fuse

# 5. cdc_acm 驱动可用（飞控插入后）
lsmod | grep cdc_acm
```

### 6.2 AppImage 启动验证

参见 [IFSC_Station_测试手册](IFSC_Station_测试手册.md) 第 2 节"冒烟测试矩阵"的 T01-T12。

### 6.3 桌面集成验证

| 验证项 | 命令 | 期望输出 |
|---|---|---|
| .desktop 文件存在 | `ls /usr/local/share/applications/ifsc-station.desktop` | 路径存在 |
| 图标主题文件 | `ls /usr/share/icons/hicolor/128x128/apps/IFSC-Station.png` | 路径存在 |
| 启动器可见 | GNOME Activities 搜 "IFSC Station" | 出现应用卡片 |
| 命令行启动 | `gtk-launch ifsc-station` | 启动主窗口 |

---

## 7. 故障排除：依赖补齐

### 7.1 启动报 `libfuse.so.2: cannot open shared object file`

```bash
sudo apt install -y libfuse2
```

### 7.2 启动报 `libQt5Core.so.5: cannot open shared object file`

```bash
sudo apt install -y libqt5core5a libqt5gui5 libqt5widgets5 libqt5qml5 libqt5quick5
```

### 7.3 启动报 `Could not load the Qt platform plugin "xcb"`

缺少 X11 / xcb 相关库：

```bash
sudo apt install -y libxcb-cursor0 libxkbcommon-x11-0 libxcb-xinerama0 libxcb-xinput0
```

### 7.4 启动报 `error: GStreamer error: no element "avdec_h264"`

缺视频解码器：

```bash
sudo apt install -y gstreamer1.0-plugins-bad gstreamer1.0-libav
```

### 7.5 启动报 `GLIBC_2.XX' not found`

系统 GLIBC 太老（< 2.14）。**升级到 Ubuntu 20.04+**：

```bash
lsb_release -a
# 期望: Ubuntu 20.04 / 22.04 / 24.04
```

### 7.6 启动后看不到串口设备

确认 dialout 组权限已生效（**重新登录过**）：

```bash
groups | grep dialout
# 如果没看到 dialout，执行: newgrp dialout 临时生效，或注销重新登录
```

### 7.7 启动后图标不显示

参考 [IFSC_Station_定制与打包手册](IFSC_Station_定制与打包手册.md) 第 10 节 #1 / #5。

---

## 8. 卸载

### 8.1 移除用户配置（保留 AppImage）

```bash
rm -rf ~/.config/QGroundControl.org/
rm -rf ~/.cache/QGCMapCache300/
rm -f ~/.icons/IFSC-Station.png
```

### 8.2 完整卸载

```bash
# 1. 移除 AppImage
sudo rm -rf /opt/ifsc-station/

# 2. 移除 .desktop
sudo rm -f /usr/local/share/applications/ifsc-station.desktop
sudo update-desktop-database

# 3. 移除图标
sudo rm -f /usr/share/icons/hicolor/*/apps/IFSC-Station.png
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor

# 4. 移除用户配置
rm -rf ~/.config/QGroundControl.org/
rm -rf ~/.cache/QGCMapCache300/
rm -f ~/.icons/IFSC-Station.png

# 5. （可选）移除依赖
sudo apt remove libqt5gui5 libfuse2
```

### 8.3 还原 dialout 组（不影响登录）

> 从 dialout 组移除普通用户会让他无法访问串口。**不建议卸载时移除**。如果一定要：

```bash
sudo deluser $USER dialout
```

---

## 9. 常见安装错误速查

| 错误 | 原因 | 解决 |
|---|---|---|
| `E: Unable to locate package libqt5xxx` | Ubuntu 20.04 镜像太老 | `sudo apt update` 后重试 |
| `dialout` 仍然不生效 | 没重新登录 | 注销 → 登录 |
| `chmod: cannot access 'IFSC-Station.AppImage': No such file or directory` | 路径错 | `pwd` 确认当前目录 |
| 双击 AppImage 没反应 | 缺 FUSE / Qt | 见 3.4 / 3.5 |
| `error while loading shared libraries: libsdl2-2.0.so.0` | SDL2 未打包 | **本 AppImage 已内置 SDL2**；如仍报此错，说明 AppImage 损坏，重新下载 |
| `QSqlDatabase: ... driver not loaded` | 缺 Qt SQL 驱动 | `sudo apt install libqt5sql5-sqlite` |
| `libdouble-conversion3` 缺失 | Ubuntu 20.04 镜像没自动装 | `sudo apt install libdouble-conversion3` |

---

## 10. 无 FUSE 环境的替代方案

某些环境（Docker 容器、CI runner、严格 SELinux / AppArmor 沙箱）**不允许 FUSE**。

### 10.1 方案 A：解包运行（推荐）

```bash
# 1. 解包
./IFSC-Station.AppImage --appimage-extract

# 2. 直接运行内部可执行文件
./squashfs-root/AppRun
# 等价于 ./squashfs-root/IFSC-Station
```

> 解包后所有数据写入 `squashfs-root/`，可移动到任意路径运行。

### 10.2 方案 B：使用 type 2 AppImage（不需 FUSE）

需要 type 2 AppImage（不需要 FUSE 挂载）。IFSC-Station V1.0 是 type 2，**不需要 FUSE 挂载**——它把 squashfs 编译进 ELF 段，运行时通过 libarchive 解压到内存。

> **本仓库的 `IFSC-Station.AppImage` 即 type 2 AppImage**，**不需要 FUSE 也能运行**。FUSE 只是 type 1 的传统方案。type 2 AppImage 在 Ubuntu 22.04+ 的无 FUSE 环境下也能直接运行（参见 https://docs.appimage.org/）。

如果遇到 FUSE 相关报错，确认是否在 macOS / Windows / 旧 Linux。**Ubuntu 20.04+ 默认都能跑**。

### 10.3 方案 C：使用沙箱（Flatpak / Snap）

如需更强的隔离，可把 AppImage 装进 Flatpak：

```bash
sudo apt install -y flatpak
flatpak install --from https://github.com/ifsc-gmlab/IFSC_Station/releases/latest/download/ifsc-station.flatpak
flatpak run ifsc.gmlab.IFSC_Station
```

> 注：IFSC-Station V1.0 暂未提供 Flatpak 打包（仅 AppImage）。如需 Flatpak，可按上文 5.x 的依赖列表在 Flatpak manifest 里声明。

---

## 附录 A：依赖包完整列表（一份安装命令搞定）

把下面整段命令直接粘到 Ubuntu 20.04+ 终端运行（**必须 sudo**），即可补齐所有依赖：

```bash
sudo apt update && sudo apt upgrade -y && \
sudo usermod -a -G dialout $USER && \
sudo apt remove -y modemmanager && \
sudo apt install -y \
    libfuse2 libqt5gui5 libqt5charts5 libqt5network5 libqt5serialport5 \
    libqt5positioning5 libqt5qml5 libqt5quick5 libqt5widgets5 \
    libqt5core5a libqt5multimedia5 libqt5multimediaquick5 libqt5location5 \
    libqt5sensors5 libqt5webchannel5 qtdeclarative5-qtquick2-plugin \
    gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-gl \
    libgl1 libglx0 libegl1 libgles2 \
    libxcb-cursor0 libxkbcommon-x11-0 libxkbcommon0 \
    libxcb-xinerama0 libxcb-xinput0 libxcb-randr0 \
    libxcb-render0 libxcb-render-util0 libxcb-shape0 \
    libxcb-shm0 libxcb-sync0 libxcb-xfixes0 libxcb-xkb1 \
    libxcb-image0 libxcb-keysyms1 \
    libfontconfig1 libfreetype6 libdbus-1-3 \
    libdouble-conversion3 libpcre2-16-0 libglib2.0-0
```

执行后**务必**：

```bash
# 1. 注销 → 重新登录（dialout 组生效）
# 2. 赋予 AppImage 执行权限
chmod +x IFSC-Station.AppImage
# 3. 启动
./IFSC-Station.AppImage
```

---

## 附录 B：与上游 QGC 安装流程的差异

| 步骤 | 上游 QGC 官方 | IFSC-Station（本手册） | 差异原因 |
|---|---|---|---|
| usermod dialout | ✅ | ✅ | 一致 |
| apt remove modemmanager | ✅ | ✅ | 一致 |
| libfuse2 | ✅ | ✅ | 一致 |
| libqt5gui5 | ✅ | ✅ | 一致 |
| GStreamer 一堆 | ✅ | ✅ | 一致 |
| 其它 Qt5 模块 | ❌ 官方只列了 1 行 | ✅ 列出完整 12+ 包 | 官方文档简化；本手册补全以避免冷启动报缺库 |
| 图形 / X11 库 | ❌ | ✅ | 官方文档未列；实际依赖 X11 客户端库 |
| hicolor 多尺寸图标 | ❌ | ✅ | 仅桌面集成可选步骤，AppImage 本身只需 `~/.icons/` 一份 |
| AppImage type | type 1（需 FUSE） | type 2（**不需 FUSE**） | IFSC-Station 是新型，兼容无 FUSE 环境 |
| 启动器图标 | 默认只复制 1 张 | 可选 hicolor 10 个尺寸 | 本手册多给一节"桌面集成" |

> 我们 IFSC-Station 的 AppImage 实际是 type 2（无需 FUSE），所以上游文档里的 `libfuse2` 在我们这里**可省略**——但保留安装以兼容最广环境。

---

附：本手册与 [IFSC_Station_定制与打包手册](IFSC_Station_定制与打包手册.md) / [IFSC_Station_测试手册](IFSC_Station_测试手册.md) / [IFSC_Station_使用手册](IFSC_Station_使用手册.md) 四份文档配套更新。
