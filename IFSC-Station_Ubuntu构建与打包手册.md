# IFSC-Station Ubuntu 22.04 端构建与打包手册

> **配套文档**：
> - **Windows 端**：[IFSC-Station_Windows定制与打包手册.md](IFSC-Station_Windows定制与打包手册.md)
> - **最终用户**：[IFSC-Station_使用手册.md](IFSC-Station_使用手册.md)
>
> 本手册面向**在 Ubuntu 22.04 上从源码构建并打包 IFSC-Station** 的开发人员。

## 1. 概述

IFSC-Station 的源码层定制（logo、应用名、版本号显示等）是**跨平台**的。本手册只覆盖**构建工具链和打包流程**在 Linux/Ubuntu 下的差异。

产物：**单文件 AppImage**（约 100 MB），双击即可运行，无需 root，无需安装。

## 2. 工具链

| 组件 | 版本 | 安装方式 |
|---|---|---|
| **Ubuntu** | 22.04 LTS（64-bit） | 系统 |
| **GCC** | 9+（Ubuntu 22.04 默认 11） | `sudo apt install build-essential` |
| **Qt** | 5.15.2（**gcc_64**） | Qt 官方 online installer（**不**用发行版包） |
| **qmake** | 与 Qt 配套 | 装 Qt 时一起 |
| **patchelf** | 任意 | `sudo apt install patchelf`（linuxdeployqt 依赖） |
| **linuxdeployqt** | continuous x86_64 | GitHub release |
| **appimagetool** | x86_64 | GitHub release |
| **libfuse2** | 任意 | `sudo apt install libfuse2`（运行 AppImage 用） |
| **GStreamer（可选）** | 1.18+ | `sudo apt install libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev` |

### 一次性安装

```bash
# 1. 系统依赖
sudo apt update
sudo apt install -y build-essential patchelf libfuse2 \
                    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
                    libssl-dev libudev-dev

# 2. Qt 5.15.2 (online installer 选 "Qt 5.15.2 → gcc_64")
#    下载: https://www.qt.io/download-qt-installer
#    装到 /opt/Qt/5.15.2/gcc_64 (或 ~/Qt/5.15.2/gcc_64)
chmod +x qt-unified-linux-x64-*.run
./qt-unified-linux-x64-*.run

# 3. linuxdeployqt + appimagetool
mkdir -p ~/tools
wget -O ~/tools/linuxdeployqt-continuous-x86_64.AppImage \
    https://github.com/probonopd/linuxdeployqt/releases/download/continuous/linuxdeployqt-continuous-x86_64.AppImage
wget -O ~/tools/appimagetool-x86_64.AppImage \
    https://github.com/AppImageCommunity/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage
chmod +x ~/tools/*.AppImage

# 4. 让 PATH 找得到 Qt
echo 'export QT_DIR=/opt/Qt/5.15.2/gcc_64' >> ~/.bashrc
echo 'export PATH=$QT_DIR/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# 5. 验证
qmake --version       # 应输出 Qt 5.15.2
g++ --version         # 应输出 GCC 9+
```

> **为什么不用发行版的 Qt？** Ubuntu 22.04 的 `qtbase5-dev` 是 5.15.3，但是 **stripped**（缺 QtQuick.Controls 2 / QtLocation / QtPositioning / 等模块）。QGC 必须用 Qt 官方 online installer 的**完整版**。

## 3. 源码层改动（跨平台，本节简述）

所有运行时定制（logo / 应用名 / 标题 / 工具栏 / 地图中心 / 品牌位）都**已经写死在源码里**，Linux 构建时无需任何修改。详见 [IFSC-Station_Windows定制与打包手册.md § 3](IFSC-Station_Windows定制与打包手册.md)。

| 文件 | 作用 | Linux 端是否生效 |
|---|---|---|
| `IFSC-Station.pro` (TARGET=IFSC-Station) | 二进制名 | ✅ |
| `qgcresources.qrc` (IFSCStationLogo aliases) | 资源 | ✅ |
| 所有 .qml 引用 `/res/IFSC-StationLogo*` | 运行时 | ✅ |
| `QGCApplication.cc` (setApplicationName) | 窗口标题 | ✅ |
| `QGCApplication.h` (constexpr) | C++17 | ✅ |
| `QGCCommon.pri` 的 MSVC flags | **MSVC 专属** | ⚪ 在 `win32 {}` 块，gcc 不解析 |
| `RC_ICONS = ...` | **Windows 专属** | ⚪ 在 `WindowsBuild {}` 块 |
| `windeployqt` post-link | **Windows 专属** | ⚪ 在 `win32 {}` 块 |
| `nullsoft_installer.nsi` | **NSIS 专属** | ⚪ 仅 `installer` scope |
| `IFSCStation.ico` | **Windows 图标** | ⚪ Linux 用 PNG 图标 |

## 4. 构建脚本：build/linux/build_IFSC-Station.sh

脚本结构与 Windows 端 `build_IFSC-Station_installer.bat` 1:1 对称：

| 阶段 | 做什么 | Windows 等价 |
|---|---|---|
| 0. 环境检查 | 检测 Qt / g++ / make / linuxdeployqt / appimagetool | 0/0b/0c |
| 1. BOM 清理 | 剥关键 .cc/.h 头 3 字节 EF BB BF | 2c |
| 2. 中间产物清理 | 删 PCH/.o/Makefile/qrc_*/moc_*/ui_* | 2b |
| 3. qmake 配置 | `qmake CONFIG+=release ../IFSC-Station.pro` | qmake |
| 4. 编译 | `make -j$(nproc)`（或 `jom`） | nmake |
| 5. rpath 修复 | `deploy/linux-fixup-rpaths.bash` | 隐含在 deploy |
| 6. AppImage 打包 | `linuxdeployqt` + `appimagetool` | NSIS |
| 7. 验证 | 输出大小、产物路径 | 3/3 verify |

### 跑

```bash
cd /path/to/qgroundcontrol
./build/linux/build_IFSC-Station.sh
```

会看到：
```
[15:23:01] [OK] Qt found: /opt/Qt/5.15.2/gcc_64
[15:23:01] [OK] GCC: g++ (Ubuntu 11.4.0) ...
[15:23:01] [OK] Build tool: make -j8
[15:23:02] [1/7] Stripping UTF-8 BOMs ...
[15:23:02] [2/7] Cleaning stale build artifacts ...
[15:23:02] [3/7] qmake configure ...
[15:23:10] [4/7] Compiling (this can take 20-40 minutes on first run) ...
...
[15:45:23] [6/7] Creating AppImage ...
[15:46:01] [7/7] Verifying artifacts ...
[15:46:01] [OK] AppImage: build/IFSC-Station-Desktop_Qt_5_15_2_GCC_64bit_Release.AppImage (98 MB)
```

### 输出

```
build/Desktop_Qt_5_15_2_GCC_64bit_Release.AppImage
```

**单文件**，用户下载后：
```bash
chmod +x IFSC-Station-*.AppImage
./IFSC-Station-*.AppImage
```

不需要安装，不需要 root。

## 5. 关键文件

| 路径 | 作用 |
|---|---|
| `build/linux/build_IFSC-Station.sh` | **主构建脚本**（唯一入口） |
| `build/linux/strip_bom.sh` | BOM 清理子脚本（自动被主脚本调用） |
| `deploy/linux-fixup-rpaths.bash` | **复用上游** rpath 修复 |
| `deploy/create_linux_appimage.sh` | **不推荐**（上游脚本有 `${VAR}` 展开 bug） |
| `deploy/qgroundcontrol-start.sh` | **不直接用**（含 QGroundControl 字面量） |
| `deploy/IFSC-Station-start.sh` | **新** IFSC 版启动脚本（但 linuxdeployqt 会自动生成 AppRun） |
| `resources/IFSCLogo.png` | AppImage 图标（256×256+ PNG） |
| `resources/IFSC-StationLogo*.svg` | 运行时 logo（应用内） |

## 6. 复用上游 vs 自写

| 阶段 | 用上游 | 用我们的 |
|---|---|---|
| qmake 流程 | ✅ | — |
| 编译 | ✅ | — |
| rpath 修复 | ✅ `linux-fixup-rpaths.bash` | — |
| AppImage 打包 | ❌ `create_linux_appimage.sh`（有 bug + 维护停摆） | ✅ `linuxdeployqt` + `appimagetool`（行业标准） |
| .desktop 文件 | ❌ 上游用 `<<\EOF` 不展开变量 | ✅ 我们用 `<<EOF` 正确展开 |
| 图标 | ❌ 上游硬链 `qgroundcontrol.png` | ✅ `QGC_CUSTOM_APP_ICON` 改用 `IFSCLogo.png` |

> **为什么不用上游 `create_linux_appimage.sh`？**
> 1. `cat > ./QGroundControl.desktop <<\EOF`（line 68）用 `<<\EOF` 反斜杠 heredoc，**禁用 shell 变量展开**——`${QGC_CUSTOM_APP_NAME}` 写成字面量，AppImage 里 .desktop 显示 "QGroundControl" 不是 "IFSC-Station"
> 2. 上游脚本 2017 年起没维护，依赖 `wget` 下载 SDL2 / directfb 的 **旧版 Debian 包**（2016 年的）
> 3. 上游用 `rsync` + `wget` + `dpkg-deb` 一条龙，不透明，难调试
>
> 我们用 `linuxdeployqt`（行业标准、自动处理 Qt + 插件 + .desktop + 图标） + `appimagetool`（轻量、官方维护）。

## 7. 常见问题

### Q: AppImage 双击没反应 / 报 FUSE 错误

```bash
sudo apt install libfuse2
# 或者不用 FUSE 直接运行：
./IFSC-Station-*.AppImage --appimage-extract-and-run
```

### Q: linuxdeployqt 报 "cannot find Qt libraries"

检查 `QT_DIR` 环境变量指向的 Qt 是**完整版**（gcc_64），不是发行版 stripped 版本。验证：
```bash
ls $QT_DIR/lib/cmake/Qt5Quick/      # 必须存在
ls $QT_DIR/lib/cmake/Qt5Location/   # 必须存在
```

### Q: QGC 启动报 "xcb" 错误

```bash
sudo apt install libxcb-cursor0 libxcb-icccm4 libxcb-image0 libxcb-keysyms1 \
                 libxcb-randr0 libxcb-render-util0 libxcb-shape0 libxcb-sync1 \
                 libxcb-xfixes0 libxcb-xkb1 libxkbcommon-x11-0
```

### Q: GStreamer 视频流没起来

```bash
sudo apt install libgstreamer1.0-0 gstreamer1.0-plugins-base \
                 gstreamer1.0-plugins-good gstreamer1.0-plugins-bad
```

### Q: AppImage 启动后窗口是黑色 / 白屏

通常是 GPU 驱动问题。先用软件渲染：
```bash
QT_QUICK_BACKEND=software ./IFSC-Station-*.AppImage
```

如果软件渲染能开，硬件加速有 bug，看 `/var/log/Xorg.0.log` 找驱动问题。

### Q: 构建报 `QSGGeometryData` 错误

这是 **BOM 问题**。跑：
```bash
./build/linux/strip_bom.sh
./build/linux/build_IFSC-Station.sh
```

### Q: AppImage 大小 > 150 MB

说明 `linuxdeployqt` 拉了多余的东西。检查：
- 不应有 `opengl32sw.dll`（Linux 不存在这个文件，跨平台问题）
- 不应有 .qm 翻译文件（脚本里加了 `-no-translations`）
- 如果包含 GStreamer 插件：这些是**必要的**（视频流依赖）

正常 80-120 MB。

## 8. 跨平台差异速查

| 任务 | Windows | Linux |
|---|---|---|
| 源码是否要改 | 改 | **不**改（直接用同一份） |
| 二进制名 | `IFSC-Station.exe` | `IFSC-Station`（无 .exe） |
| 主脚本 | `build\windows\build_IFSC-Station_installer.bat` | `build/linux/build_IFSC-Station.sh` |
| 编译器 | MSVC 2019 (16.x) | GCC 9+ |
| 部署工具 | windeployqt | linuxdeployqt + appimagetool |
| 安装器 | NSIS .exe | AppImage |
| 安装器大小 | ~100 MB | ~100 MB |
| 任务栏图标 | `IFSC-Station.ico` | `~/.icons/IFSC-Station.png` |
| 启动菜单项 | NSIS 自动创建 | `AppDir/IFSC-Station.desktop` |
| 卸载 | NSIS `IFSC-Station-Uninstall.exe` | `rm -f ~/.../IFSC-Station.AppImage` |
| 配置文件 | `%APPDATA%\IFSC-Station\` | `~/.config/IFSC-Station/` |

## 9. 与 Ubuntu 端现有 IFSC-Station 仓库的关系

GitHub `ifsc-gmlab/IFSC_Station` 上有之前的 Ubuntu 版（`IFSC-Station_V1.0` 分支），那是 **Linux 单独的定制**（图标用 PNG 替代 .svg、字体调整等）。本手册构建出的 Linux 版是**统一版**：

- 同一份 `IFSC-Station.pro` 源码
- 同一个 `TARGET = IFSC-Station`
- 同一套运行时 logo（`IFSC-StationLogoFull.svg` 等）
- 同时支持 Windows + Linux 双平台部署

部署时不需要选分支，团队成员直接 clone 同一份源码，各自跑对应平台的脚本即可。

## 10. 复现检查清单

在干净 Ubuntu 22.04 上验证：

- [ ] `qmake --version` 输出 Qt 5.15.x
- [ ] `g++ --version` 输出 9+
- [ ] `which patchelf` 有结果
- [ ] `ls ~/tools/linuxdeployqt-continuous-x86_64.AppImage` 存在
- [ ] `ls ~/tools/appimagetool-x86_64.AppImage` 存在
- [ ] `ls /opt/Qt/5.15.2/gcc_64/lib/cmake/Qt5Quick/` 存在
- [ ] `ls resources/IFSCLogo.png` 存在
- [ ] `ls build/linux/build_IFSC-Station.sh` 存在
- [ ] 跑 `build/linux/build_IFSC-Station.sh`
- [ ] 等待 20-40 分钟（首次全量编译）
- [ ] 输出 `build/IFSC-Station-*.AppImage`（~100 MB）
- [ ] `chmod +x` + 双击运行
- [ ] 顶部窗口标题是 `IFSC-Station`（不是 `IFSC-Station Daily`）
- [ ] 工具栏左上角是 IFSC logo（不是 QGC 绿钩）
- [ ] 飞行地图中心是 IFSC 箭头（旋转方向正确）

全部勾选 → 部署成功。
