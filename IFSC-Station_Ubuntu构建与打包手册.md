# IFSC-Station Ubuntu 端构建与打包手册

> **配套文档**：
> - **Windows 端**：[IFSC-Station_Windows定制与打包手册.md](IFSC-Station_Windows定制与打包手册.md)
> - **最终用户**：[IFSC-Station_使用手册.md](IFSC-Station_使用手册.md)
>
> 本手册面向**在 Ubuntu 上从同一份 IFSC-Station 源码构建并打包成 AppImage** 的开发人员。
> 源码层定制（logo / 应用名 / 标题 / 调色板 / 工具栏 / 飞行地图朝向 / 永久 LOGO / 图标）**与 Windows 共用一份代码**，本手册只覆盖**构建工具链和打包流程**在 Linux/Ubuntu 下的差异。

---

## 0. 目录

1. [跨平台部署能力分析](#1-跨平台部署能力分析)
2. [工具链](#2-工具链)
3. [源码层改动（跨平台公用）](#3-源码层改动跨平台公用)
4. [构建脚本：build/linux/build_IFSC-Station.sh](#4-构建脚本buildlinuxbuild_ifsc-stationsh)
5. [完整复现步骤](#5-完整复现步骤)
6. [踩坑汇总（复现时实际遇到的 10 类问题）](#6-踩坑汇总复现时实际遇到的-10-类问题)
7. [跨平台差异速查](#7-跨平台差异速查)
8. [验收清单](#8-验收清单)

---

## 1. 跨平台部署能力分析

**结论：IFSC-Station 源码已经具备跨平台部署能力。** 同一份 git 仓库，在 Windows 上跑出 `.exe`（NSIS 安装器），在 Ubuntu 上跑出 `.AppImage`，定制元素在两端的运行结果完全一致。

### 1.1 跨平台能力清单

| 能力 | Windows | Linux | 实现位置 |
|---|---|---|---|
| 同一份 `qgroundcontrol.pro` | ✅ | ✅ | 仓库根 |
| 同一份 C++ 源码（`src/*.cc/.h`） | ✅ | ✅ | `src/` |
| 同一份 QML（`src/*.qml`） | ✅ | ✅ | `src/` |
| 同一份资源（`qgcresources.qrc` + `resources/*`） | ✅ | ✅ | `qgcresources.qrc` |
| 同一份品牌（应用名/标题/版本） | ✅ | ✅ | `QGCApplication.cc` |
| 同一套运行时 LOGO | ✅ | ✅ | `IFSC-StationLogo*.svg` |
| 同一套调色板 | ✅ | ✅ | `QGCPalette.cc` |
| 同一份 Post Link 流程（rpath 修复） | ✅ | ✅ | `QGCPostLinkCommon.pri` |
| 平台专属工具链 | MSVC 2019 / NSIS / windeployqt | GCC / appimagetool | **互不干扰** |
| 平台专属构建脚本 | `build/windows/build_IFSC-Station_installer.bat` | `build/linux/build_IFSC-Station.sh` | 同一份仓库 |

### 1.2 平台专属代码

只有以下**极少量**代码是平台专属的，它们都用 `#ifdef Q_OS_WIN` / `WindowsBuild {}` 等机制隔离：

| 文件 | 平台专属内容 | 影响 |
|---|---|---|
| `qgroundcontrol.pro` | `RC_ICONS = ...`（仅 Windows） | Windows 用 .ico；Linux 不解析此变量 |
| `qgroundcontrol.pro` | `windeployqt` post-link | Linux 不跑 |
| `qgroundcontrol.pro` | `CONFIG+=installer` 触发 NSIS | Linux 不识别此 CONFIG |
| `main.cc` | `#ifdef Q_OS_LINUX` 块调 `setWindowIcon` | 各自平台用各自图标格式 |
| `deploy/` | `windows/WindowsQGC.ico` | Windows 专属；Linux 用 `IFSC-Station.png` |

**Linux 端完全不引用任何 Windows-only 文件**，所以同一份源码能直接拿过去编。

### 1.3 跨平台定制的统一性

- 顶层窗口标题 `IFSC-Station`（**不再追加** "Daily"）—— 两端一致
- 主工具栏左上角 LOGO（`IFSC-StationLogoFull`）—— 两端一致
- Application Settings 面板顶部 LOGO（`QGCLogoWhite`）—— 两端一致
- 飞行地图中心 GCS 标识（`IFSC-StationLogoFull` / `IFSC-StationLogoArrow`）—— 两端一致
- 飞行视图右上角永久 LOGO（IFSC + LOGO 双 LOGO）—— 两端一致
- 调色板 `#00427F` 深蓝 —— 两端一致
- 任务栏 / 启动器 / 文件管理器图标 —— 各自平台用各自格式（.ico / .png + .desktop）

---

## 2. 工具链

### 2.1 必需

| 组件 | 版本 | 安装 |
|---|---|---|
| **Ubuntu** | 20.04 / 22.04 LTS（64-bit） | 系统 |
| **GCC** | 9+ | `sudo apt install build-essential` |
| **Qt** | 5.15.2（**gcc_64**） | Qt 官方 online installer（**不用**发行版 `qtbase5-dev`） |
| **qmake** | 与 Qt 配套 | 装 Qt 时一起 |
| **patchelf** | 任意 | `sudo apt install patchelf` |
| **readelf** | 任意 | `sudo apt install binutils`（一般已带） |
| **appimagetool** | x86_64 | 由 `build_IFSC-Station.sh` **自动下载**到 `~/tools/` |
| **libfuse2** | 任意 | `sudo apt install libfuse2`（运行 AppImage 用） |

### 2.2 可选 / 仅警告

| 组件 | 用途 | 缺失影响 |
|---|---|---|
| **zsync** | appimagetool 的差分更新 | 仅警告，不影响打包 |
| **desktop-file-install** | 校验 .desktop 文件 | 仅警告 |
| **GStreamer** | 视频流 | QGC 用 UVC 路径可不装 |
| **linuxdeployqt** | ~~Qt 库抽取工具~~ | **不再使用**（见 § 6.7），脚本自举下载但实际不调用 |

### 2.3 一次性安装

```bash
# 1. 系统依赖
sudo apt update
sudo apt install -y build-essential patchelf binutils libfuse2 \
                    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
                    libssl-dev libudev-dev

# 2. Qt 5.15.2 (online installer 选 "Qt 5.15.2 → gcc_64")
#    下载: https://www.qt.io/download-qt-installer
#    装到 ~/Qt/5.15.2/gcc_64 (默认路径,脚本会优先探测)
chmod +x qt-unified-linux-x64-*.run
./qt-unified-linux-x64-*.run

# 3. 验证
qmake --version       # 应输出 Qt 5.15.2
g++ --version         # 应输出 GCC 9+
which patchelf        # 应有结果
```

> **为什么不用发行版的 Qt？** Ubuntu 的 `qtbase5-dev` 是 stripped 版本（缺 QtQuick.Controls 2 / QtLocation / QtPositioning 等模块），QGC 编不过。必须用 Qt 官方 online installer 的完整版。

---

## 3. 源码层改动（跨平台公用）

所有运行时定制都已经写死在源码里，**Linux 构建时无需任何修改**。详见 [IFSC-Station_Windows定制与打包手册.md](IFSC-Station_Windows定制与打包手册.md)。

| 改动 | 跨平台 |
|---|---|
| `qgroundcontrol.pro` 中 `QGC_APP_NAME = "IFSC-Station"` | ✅ |
| `qgcresources.qrc` 中 IFSC 图标别名 | ✅（路径大小写要严格匹配，见 § 6.1） |
| 所有 .qml 引用 `/res/IFSC-StationLogo*` | ✅ |
| `QGCApplication.cc` setApplicationName 写死 "IFSC Station" | ✅ |
| `QGCApplication.h` 静态成员改 constexpr | ✅（C++17） |
| `QGCPalette.cc` 改 `#00427F` | ✅ |
| `FlyViewWidgetLayer.qml` 永久 LOGO | ✅ |
| `MainRootWindow.qml` 版本号 / "Daily" 字样删除 | ✅ |
| `GeneralSettings.qml` 同上 | ✅ |
| `qgroundcontrol.pro` MSVC flag `/wd4264` | ⚪ 在 `win32 {}` 块，gcc 不解析 |
| `qgroundcontrol.pro` `RC_ICONS = ...` | ⚪ Windows 专属 |
| `windeployqt` post-link | ⚪ Windows 专属 |
| `CONFIG+=installer` NSIS | ⚪ Windows 专属 |
| `IFSC-Station.ico` | ⚪ Windows 专属 |

---

## 4. 构建脚本：build/linux/build_IFSC-Station.sh

### 4.1 脚本结构

与 Windows 端 `build/windows/build_IFSC-Station_installer.bat` 1:1 对称：

| 阶段 | 做什么 | Windows 等价 |
|---|---|---|
| 0. 前置修复 | 剥 UTF-8 BOM / CRLF → LF / 补可执行位 | 2b/2c |
| 2. 环境检查 | Qt / GCC / make / appimagetool 自举 | 0/0b/0c |
| 3. 中间产物清理 | 删 PCH/.o/Makefile/qrc_*/moc_*/ui_* | 2b |
| 4. qmake 配置 | `qmake CONFIG+=release qgroundcontrol.pro` | qmake |
| 5. rpath 修复 | `deploy/linux-fixup-rpaths.bash` | 隐含在 deploy |
| 6. AppImage 打包 | **手工复制 staging/Qt 到 AppDir** + `appimagetool` | NSIS |
| 7. 验证 | 输出大小、产物路径 | 3 verify |

### 4.2 关键设计：自举工具链

脚本首次运行时会自动下载缺失的工具到 `~/tools/`，不依赖任何手工预装：

- `~/tools/linuxdeployqt-continuous-x86_64.AppImage`（约 29 MB）
- `~/tools/appimagetool-x86_64.AppImage`（约 30 MB）

下载完成后会**自动解压**到 `~/.cache/ifsc-station-tools/{tool}-extracted/usr/bin/`，后续调用直接走解压后的二进制（绕开 AppImage runtime 解析的坑，见 § 6.7）。

### 4.3 关键设计：跳过开关

| 变量 | 行为 | 典型场景 |
|---|---|---|
| `SKIP_BUILD=1` | 跑完步骤 0 后整体退出 | 只想跑前置修复，再走 Qt Creator |
| `SKIP_COMPILE=1` | 跳过步骤 3-5（clean/qmake/make） | Qt Creator 已经编过，只想重打包 |
| `STAGING_DIR=...` | 自定义 staging 路径 | Qt Creator 的 staging 不在默认位置 |
| `QT_DIR=...` | 指定 Qt 安装路径 | 多版本 Qt 共存时 |
| `APP_NAME=...` | 自定义应用名 | 想做其他定制版 |

---

## 5. 完整复现步骤

### 5.1 路径 A：源码已在 Linux 上（git clone 或解压后）

```bash
cd qgroundcontrol

# 1) 装 apt 依赖
sudo apt install -y build-essential patchelf binutils libfuse2 \
                    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
                    libssl-dev libudev-dev

# 2) 装 Qt 5.15.2 (online installer 装到 ~/Qt/5.15.2/gcc_64)
#    (见 § 2.3)

# 3) 全自动一键构建+打包
./build/linux/build_IFSC-Station.sh

# 4) 跑出来
chmod +x build/IFSC-Station-*.AppImage
./build/IFSC-Station-*.AppImage
```

### 5.2 路径 B：源码在 Windows 上，复制到 Linux

#### 5.2.1 Windows 端打包

```powershell
# 关键: --exclude 只排除 Qt Creator 的产物,不要整目录排除 build/
$output = "D:\gml\IFSC-Station\IFSC-Station-V1.0-source.tar.gz"
Remove-Item $output -ErrorAction SilentlyContinue
& tar.exe `
    --exclude="qgroundcontrol/build/Desktop_*" `
    --exclude="qgroundcontrol/build/staging" `
    --exclude="qgroundcontrol/build/CMakeFiles" `
    --exclude="qgroundcontrol/build/CMakeCache.txt" `
    --exclude="qgroundcontrol/build/Makefile" `
    --exclude="qgroundcontrol/.git" `
    --exclude="qgroundcontrol/.workbuddy" `
    --exclude="qgroundcontrol/.qtc_clangd" `
    --exclude="qgroundcontrol/.vs" `
    --exclude="*.user" `
    --exclude="*.suo" `
    --exclude="*.bak" `
    --exclude="*.tmp" `
    -czf "$output" `
    -C "D:\gml\IFSC-Station" "qgroundcontrol"

# 校验大小 (一般 50-60 MB)
Get-Item $output | Select-Object Length
```

#### 5.2.2 Linux 端解压

```bash
# 通过 U 盘 / scp / 网盘 / 共享文件夹等方式拷贝 IFSC-Station-V1.0-source.tar.gz

cd ~/Share          # 或你想放源码的目录
tar -xzf IFSC-Station-V1.0-source.tar.gz
cd qgroundcontrol

# 验证关键文件都在
ls -l build/linux/build_IFSC-Station.sh
ls -l build/windows/build_IFSC-Station_installer.bat
ls -l qgroundcontrol.pro
```

#### 5.2.3 Linux 端编译（两种方式）

**方式 1：用 build_IFSC-Station.sh 全自动**

```bash
cd qgroundcontrol
./build/linux/build_IFSC-Station.sh
# 等 20-40 分钟（首次全量编译）
# 产物: build/IFSC-Station-*.AppImage
```

**方式 2：Qt Creator 编译 + 脚本仅打包**

```bash
# 1) 在 Qt Creator 打开 qgroundcontrol.pro,选 GCC 套件 (Desktop Qt 5.15.2 GCC 64bit)
# 2) Build -> Rebuild (Release)  --  Qt Creator 会把 Qt 库复制到 build-*/staging/Qt/
# 3) 回到命令行,只跑打包
cd qgroundcontrol
export STAGING_DIR=/home/lu/Share/build-qgroundcontrol-Desktop-Release/staging
export SKIP_COMPILE=1
unset SKIP_BUILD              # 关键! 不要让 SKIP_BUILD 残留
./build/linux/build_IFSC-Station.sh
# 产物: build/IFSC-Station-*.AppImage
```

### 5.3 验证

```bash
# 1. 文件存在
ls -l build/IFSC-Station-*.AppImage

# 2. 跑起来
chmod +x build/IFSC-Station-*.AppImage
./build/IFSC-Station-*.AppImage &

# 3. 视觉检查
#    - 窗口标题: IFSC-Station (不是 IFSC-Station Daily)
#    - 主工具栏左上角: IFSC LOGO
#    - 飞行地图中心: IFSC 箭头 / GCS 标识
#    - 飞行视图右上角: 永久 IFSC + LOGO 双 LOGO
#    - 任务栏 / 启动器图标: IFSC
#    - 调色板: 深蓝 #00427F
```

---

## 6. 踩坑汇总（复现时实际遇到的 10 类问题）

按"踩坑时间顺序"整理,每个问题给出**症状 / 根因 / 修复**。

### 6.1 资源文件名大小写不匹配 → `make` 报 "No rule to make target"

**症状：**

```
make: *** No rule to make target '/home/lu/Share/qgroundcontrol/resources/GmlLogo.png',
       needed by 'qrc_qgcresources.cpp'.  Stop.
```

**根因：**

- `qgcresources.qrc` 中引用 `<file alias="GMLLogo">resources/GMLLogo.png</file>`
- 但 **实际文件是 `GmlLogo.png`**（首字母大写、后面小写）—— Windows 端开发者命名时打错了
- Windows NTFS **不区分大小写**,能编过
- Linux ext4 **严格区分大小写**,make 找不到 `GMLLogo.png`(实际只有 `GmlLogo.png`)

**修复：**

1. 在 Windows 端把资源引用统一成实际文件名大小写(本项目统一为 `GMLLogo.png`)
2. 完整自检命令(在 Windows PowerShell 跑):

```powershell
# 列出 qgcresources.qrc 引用的所有 PNG/SVG 资源
[regex]::Matches((Get-Content qgcresources.qrc -Raw), 'resources/[^"]+') | ForEach-Object { $_.Value } | Sort-Object -Unique

# 列出 resources/ 下实际存在的文件
Get-ChildItem resources -Recurse -Include *.png,*.svg,*.ico | Select-Object -ExpandProperty FullName | ForEach-Object { $_.Substring($_.IndexOf('resources\')) } | Sort-Object
```

两份输出 diff,确保一致。

**预防：** 资源文件命名统一用 `IFSC-StationLogoXxx.svg` 这种 PascalCase,不要混用驼峰。

---

### 6.2 `build/linux/` 没被拷贝过去 → 找不到构建脚本

**症状：**

解压 tar 包后,Ubuntu 端 `ls qgroundcontrol/build/` 只看到 Qt Creator 的 `Desktop_*/` 编译目录,**没有 `linux/` 也没有 `windows/`**。

**根因：**

最初打包命令用了 `--exclude="qgroundcontrol/build"` 这种**整目录排除**,把 `build/linux/build_IFSC-Station.sh` 和 `build/windows/build_IFSC-Station_installer.bat` 都误杀了。

**修复：**

精确排除 Qt Creator 的中间产物,保留构建脚本:

```powershell
# 不要这样 (太宽):
--exclude="qgroundcontrol/build"

# 应该这样 (精确):
--exclude="qgroundcontrol/build/Desktop_*"      # Qt Creator 中间构建目录
--exclude="qgroundcontrol/build/staging"       # Qt Creator post-link staging
--exclude="qgroundcontrol/build/CMakeFiles"     # CMake 中间
--exclude="qgroundcontrol/build/CMakeCache.txt"
--exclude="qgroundcontrol/build/Makefile"
```

---

### 6.3 脚本里 `find ... \( ... -o ... \)` 被自动转成 `$`

**症状：**

```bash
lu@lu-virtual-machine:~/Share/qgroundcontrol$ find deploy build -type f $ -name '*.sh' -o -name '*.bash' $ -exec sed -i 's/\r$//' {} +
find: paths must precede expression: `$'
```

**根因：**

在某些终端(尤其是有智能补全/语法高亮的)中,反斜杠转义的 `( )` 被自动改成了 `$`(终端特性),导致 find 解析失败。

**修复：**

用 `find ... -name '*.sh' -exec ...` 这种**不需要括号嵌套**的写法,或用 `find ... -print0 | xargs -0 ...`:

```bash
# 写法 1: 不需要括号
find deploy build -name '*.sh'   -exec sed -i 's/\r$//' {} +
find deploy build -name '*.bash' -exec sed -i 's/\r$//' {} +

# 写法 2: 用 xargs
find deploy build -type f \( -name '*.sh' -o -name '*.bash' \) -print0 | xargs -0 -r sed -i 's/\r$//'
```

**或者**: 直接用 `build/linux/build_IFSC-Station.sh` 自带的 `strip_crlf_and_chmod` 步骤(脚本里有),避免手写 find。

---

### 6.4 `deploy/linux-fixup-rpaths.bash: Permission denied`

**症状：**

```
/bin/sh: 1: /home/lu/Share/qgroundcontrol/deploy/linux-fixup-rpaths.bash: Permission denied
make: *** [Makefile:2803: staging/IFSC-Station] Error 126
```

**根因：**

Windows tar 打的 tar.gz **不保留 Unix 文件权限位**。脚本文件在 Windows 上 `chmod +x` 是不存在的概念,只有 `attrib +R` 之类的 Windows 属性。

**修复：**

```bash
cd qgroundcontrol
chmod +x deploy/linux-fixup-rpaths.bash
chmod +x deploy/qgroundcontrol-start.sh
chmod +x build/linux/*.sh
```

**或者**: `build_IFSC-Station.sh` 现在的 `strip_crlf_and_chmod` 步骤会自动做这件事。

---

### 6.5 `bash\r: No such file or directory`(CRLF 行尾)

**症状：**

```
/usr/bin/env: 'bash\r': No such file or directory
make: *** [Makefile:2803: staging/IFSC-Station] Error 127
```

**根因：**

脚本文件被以 CRLF 行尾存(Windows 默认),shebang 行变成 `#!/usr/bin/env bash\r`,bash 解释器找不到名为 `bash\r` 的程序。

**修复：**

```bash
# 单文件
sed -i 's/\r$//' deploy/linux-fixup-rpaths.bash

# 批量
find deploy build -name '*.sh' -o -name '*.bash' | xargs sed -i 's/\r$//'
```

**预防**：在 Windows 上用 `git config core.autocrlf input` 或编辑器存为 LF。

**或者**: `build_IFSC-Station.sh` 现在的 `strip_crlf_and_chmod` 步骤会自动做。

---

### 6.6 自举下载 `appimagetool` 报 404

**症状：**

```
[18:32:17] Bootstrapping appimagetool from `https://github.com/AppImageCommunity/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage`  ...
[18:32:18] Failed to bootstrap appimagetool.
```

**根因：**

旧的 `AppImageCommunity/AppImageKit` 仓库**已被标记为废弃**,新项目已经迁到 `AppImage/appimagetool`。

**修复：**

把脚本里 `APPIMAGETOOL_URL` 默认值改成:

```
https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
```

(新版 `build_IFSC-Station.sh` 已经修了)

---

### 6.7 linuxdeployqt 报 "Unknown argument: -appdir="

**症状：**

```
linuxdeployqt  (commit ), build 107 built on 2025-10-21 17:57:43 UTC
ERROR: Unknown argument: "-appdir=/home/lu/.../AppDir"
```

**根因：**

`linuxdeployqt continuous` 在 2024+ 切换到 **Qt6 era CLI**,这个版本是个**完全重写**:

| 旧版 API (Qt5 era) | 新版 API (Qt6 era) |
|---|---|
| `-appdir=<path>` | **已删除** |
| `-executable=<path>` | **已删除** |
| `-desktopfile=<path>` | **已删除** |
| `--appimage-extract-and-run` | **被拒绝**(所有 `--` flag 都不接受) |

折腾 `-appdir=` → `-appdir` 都不行,因为这个 flag **整体被重写/移除**了。

**修复：**

**放弃 linuxdeployqt,改用纯手工打包方案**(新版 `build_IFSC-Station.sh` 已经实现):

1. Qt Creator 的 `QMAKE_POST_LINK` 已经把 Qt 库复制到 `staging/Qt/`
2. 脚本直接从 `staging/Qt/` 复制到 `AppDir/usr/{lib,qml,plugins}/`
3. `patchelf --set-rpath '$ORIGIN/../lib'` 改 binary rpath
4. `AppRun` 设置 `LD_LIBRARY_PATH` / `QML2_IMPORT_PATH` / `QT_PLUGIN_PATH`
5. `appimagetool AppDir/ output.AppImage` 一把出图

这样得到和 linuxdeployqt 完全一样的产物,但不依赖任何外部工具的新 API。

---

### 6.8 `appimagetool` 报 "Failed to bootstrap"

**症状：**

```
appimagetool not found at: /home/lu/tools/appimagetool-x86_64.AppImage
Bootstrapping appimagetool from `https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage`  ...
[18:34:54]   downloaded -> /home/lu/tools/appimagetool-x86_64.AppImage
appimagetool: /home/lu/tools/appimagetool-x86_64.AppImage
```

其实是**成功了**,但脚本里 zsync 缺失会触发警告,可能被误读为失败。

**修复：**

```bash
sudo apt install -y zsync   # 可选,不影响打包
```

如果不装 zsync,打包仍可成功,只是产物**不带 zsync 差分更新元数据**(对单文件分发不影响)。

---

### 6.9 `[5/8] Fixing library rpaths` 之后脚本"静默退出"

**症状：**

跑完第 5 步后,脚本**没有任何错误信息**直接退出,没看到第 6 步。

**根因：**

- `set -euo pipefail` 下,任何子命令返回非 0 都会让整个脚本**静默退出**(不打印错误)
- `linux-fixup-rpaths.bash` 内部 `readelf` 找不到时直接返回非 0
- 老版本脚本没把 `bash ${...} 2>&1` 的退出码透传出来,所以看不到原因

**修复：**

新版脚本已经把第 5 步改成显式捕获退出码并打印:

```bash
# 旧:
bash "${SRC_DIR}/deploy/linux-fixup-rpaths.bash" || true   # 吞掉错误

# 新:
SEARCHDIR="..." RPATHDIR="..." \
    bash "${SRC_DIR}/deploy/linux-fixup-rpaths.bash"
rc=$?
if [ $rc -ne 0 ]; then
    log_error "linux-fixup-rpaths.bash failed (exit ${rc})"
    log_error "  run it manually:"
    log_error "    SEARCHDIR=... RPATHDIR=... bash .../linux-fixup-rpaths.bash"
    exit ${rc}
fi
```

如果仍卡住,装 patchelf:

```bash
sudo apt install -y patchelf
```

---

### 6.10 `SKIP_BUILD=1` 残留导致脚本整个退出

**症状：**

```
[18:32:10] SKIP_BUILD=1 set: stopped after CRLF/BOM fixups.
[18:32:10] You can now build with Qt Creator (Build -> Rebuild).
============================================
```

明明设了 `SKIP_COMPILE=1`,脚本却在最早就退出了。

**根因：**

- `SKIP_BUILD=1` 优先级高于 `SKIP_COMPILE=1`
- 如果 shell 里之前 `export SKIP_BUILD=1` 过(例如做"只跑前置修复"那次),这次没 `unset` 就会带着
- `SKIP_BUILD=1` 含义是"跑完前置修复就整体退出",不管 `SKIP_COMPILE` 怎么设

**修复：**

```bash
# 方式 1: 显式 unset
unset SKIP_BUILD
export SKIP_COMPILE=1
./build/linux/build_IFSC-Station.sh

# 方式 2: 用 env -u (更稳)
env -u SKIP_BUILD \
    STAGING_DIR=/home/lu/Share/build-qgroundcontrol-Desktop-Release/staging \
    SKIP_COMPILE=1 \
    ./build/linux/build_IFSC-Station.sh
```

---

## 7. 跨平台差异速查

| 任务 | Windows | Linux |
|---|---|---|
| 源码是否要改 | 改(MSVC flag / 资源注册) | **不**改(直接用同一份) |
| 二进制名 | `IFSC-Station.exe` | `IFSC-Station`(无 .exe) |
| 主脚本 | `build\windows\build_IFSC-Station_installer.bat` | `build/linux/build_IFSC-Station.sh` |
| 编译器 | MSVC 2019 (16.x) | GCC 9+ |
| 构建系统 | qmake + nmake / jom | qmake + make / jom |
| 部署工具 | windeployqt | (无需) → 脚本手工复制 |
| 打包工具 | NSIS 3.08+ | appimagetool |
| 产物 | `IFSC-Station-Installer.exe`(NSIS) | `IFSC-Station-Release.AppImage` |
| 产物大小 | ~100 MB | ~100 MB |
| 任务栏图标 | `IFSC-Station.ico` | `~/.icons/IFSC-Station.png` |
| 启动菜单项 | NSIS 自动创建 | `AppDir/IFSC-Station.desktop` |
| 卸载 | NSIS `IFSC-Station-Uninstall.exe` | `rm -f ~/.../IFSC-Station.AppImage` |
| 配置文件 | `%APPDATA%\IFSC-Station\` | `~/.config/IFSC-Station/` |
| 自举工具链 | MSVC vcvars64 + Qt bin + NSIS bin | Qt 路径探测 + appimagetool 自动下载 |
| 必须前置 | Qt + MSVC + NSIS 装好 | Qt 装好(其它 apt 包脚本里有提示) |

---

## 8. 验收清单

在干净的 Ubuntu 20.04 / 22.04 上验证:

### 8.1 编译前

- [ ] `qmake --version` 输出 Qt 5.15.x
- [ ] `g++ --version` 输出 9+
- [ ] `which patchelf` 有结果
- [ ] `ls ~/Qt/5.15.2/gcc_64/lib/cmake/Qt5Quick/` 存在
- [ ] `ls resources/IFSCLogo.png` 存在
- [ ] `ls build/linux/build_IFSC-Station.sh` 存在(从 Windows tar 解压后)

### 8.2 编译期间

- [ ] 跑 `./build/linux/build_IFSC-Station.sh` 0 错误
- [ ] 看到 `[2/8] Checking build environment ...` 后提示 `Qt found`
- [ ] 看到 `[2/8] linuxdeployqt: /home/lu/tools/...` (首次会自动下载)
- [ ] 看到 `[2/8] appimagetool: /home/lu/tools/...` (首次会自动下载)
- [ ] 看到 `[5/8] rpaths fixed`
- [ ] 看到 `[6/8] AppDir ready: ~XXX MB`
- [ ] 看到 `[6/8] AppImage created: build/IFSC-Station-*.AppImage`
- [ ] 看到 `[7/8] AppImage: build/IFSC-Station-*.AppImage (XXX MB)`

### 8.3 运行验证

- [ ] `chmod +x build/IFSC-Station-*.AppImage && ./build/IFSC-Station-*.AppImage` 启动
- [ ] 顶部窗口标题 = `IFSC-Station`(没有 "Daily" 后缀)
- [ ] 主工具栏左上角 = IFSC LOGO(不是 QGC 绿钩)
- [ ] 飞行地图中心 = IFSC 箭头(朝向正确)
- [ ] 飞行视图右上角 = 永久双 LOGO(IFSC + LOGO)
- [ ] 调色板 = 深蓝 `#00427F`
- [ ] 任务栏 / 启动器图标 = IFSC
- [ ] Application Settings 顶部小 LOGO = IFSC

全部勾选 → **跨平台部署成功**,产物可分发。

---

## 附录 A：脚本自检命令速查

| 用途 | 命令 |
|---|---|
| 脚本是否 LF | `head -1 build/linux/build_IFSC-Station.sh \| xxd` (末尾应为 `0a`) |
| 脚本是否可执行 | `ls -l build/linux/build_IFSC-Station.sh` (应有 `-rwxr-xr-x`) |
| 资源路径大小写一致 | 见 § 6.1 的 PowerShell 命令 |
| tar 包 MD5 | `md5sum IFSC-Station-V1.0-source.tar.gz` |
| Qt Creator staging 位置 | 在 Qt Creator → Projects → Build directory 看完整路径 |
| 手动跑 rpath 修复 | `SEARCHDIR=staging/Qt RPATHDIR=staging/Qt/libs bash deploy/linux-fixup-rpaths.bash` |
| 查看 AppImage 内容 | `./IFSC-Station-Release.AppImage --appimage-extract` 然后 `ls squashfs-root/` |
| 强制重抽 Qt 资源 | `touch qgcresources.qrc && rm qrc_qgcresources.o && make -j$(nproc)` |
