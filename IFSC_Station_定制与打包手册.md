# IFSC-Station 定制与打包手册

> ⚠️ **弃用说明（2026-07-22）**：本手册描述的是 **Ubuntu / Linux 下的 appimage 打包流程**，已**不再适用**当前的 Windows 定制。
>
> 当前 IFSC-Station 项目请改用：
> - **源码级定制 + Windows 打包**：[IFSC-Station_Windows定制与打包手册.md](IFSC-Station_Windows定制与打包手册.md)
> - **用户使用**：[IFSC-Station_使用手册.md](IFSC-Station_使用手册.md)
>
> 本文件**保留仅供历史参考**，包含 4.2.8 早期 Linux 定制阶段的改动记录。

> 适用源码版本：**QGroundControl 4.2.8**（`GIT_DESCRIBE = v4.2.8`，基于 mavlink/qgroundcontrol@v4.2.8 tag）。
> 适用构建系统：**qmake + Qt 5.15.x**（Linux release 构建）。
> 项目根目录以下用 `.` 表示，所有相对路径均从仓库根目录出发。
> 本手册基于 `IFSC_Station_定制手册-4.md` 的初版，并**追加了实际复现时遇到的问题与解决方法**。

---

## 0. 目录

1. [概述](#1-概述)
2. [顶部窗口标题从 `QGroundControl Daily` 改为 `IFSC Station`](#2-顶部窗口标题-qgroundcontrol-daily--ifsc-station)
3. [主窗口 / 设置面板中版本号替换并居中](#3-主窗口--设置面板中版本号替换并居中)
4. [关闭 `New Version Available` 升级弹窗](#4-关闭-new-version-available-升级弹窗)
5. [替换工具栏 / AppSettings / 飞行地图朝向 logo](#5-替换工具栏--appsettings--飞行地图朝向-logo)
6. [主界面飞行视图右上角永久显示两个自定义 LOGO](#6-主界面飞行视图右上角永久显示两个自定义-logo)
7. [把 `brandingPurple` 调色板改成深蓝 `#00427F`](#7-把-brandingpurple-调色板改成深蓝-00427f)
8. [任务栏 / 启动器 / 文件管理器图标的设置](#8-任务栏--启动器--文件管理器图标的设置)
9. [AppImage 打包脚本 `create_IFSC-Station_appimage.sh` 使用说明](#9-appimage-打包脚本-create_ifsc-station_appimagesh-使用说明)
10. [复现过程中遇到的问题与解决办法（重要！）](#10-复现过程中遇到的问题与解决办法重要)
11. [关于 `custom-example/` 的取舍说明](#11-关于-custom-example-目录的取舍说明)
12. [整套改动文件清单](#12-整套改动文件清单)
13. [复现检查清单](#13-复现检查清单)
14. [工程文件改名（去 qgroundcontrol 化：`qgroundcontrol.pro` → `IFSC-Station.pro`）](#14-工程文件改名去-qgroundcontrol-化qgroundcontrolpro--ifsc-stationpro)

---

## 1. 概述

IFSC-Station 是基于 QGroundControl 4.2.8 的定制分支，主要修改：

- **品牌化**：应用名 `IFSC Station`，版本号 `V1.0`，关闭版本升级检查
- **Logo 替换**：工具栏 / AppSettings / 飞行地图朝向 SVG 全部替换为 IFSC 自有 LOGO
- **永久 LOGO**：主界面飞行视图右上角永久显示两张 LOGO（与仪表盘等高、随仪表盘缩放）
- **配色统一**：`brandingPurple` 改为深蓝 `#00427F`，与 `mainStatusBGColor` 统一
- **图标定制**：任务栏 / 启动器 / 文件管理器均使用 IFSC-Station 图标
- **AppImage 打包**：提供与上游同构的 `create_IFSC-Station_appimage.sh` 打包脚本

所有定制**仅修改 13 个文件**（10 个修改 + 3 个新增），单 binary 即可。

---

## 2. 顶部窗口标题：`QGroundControl Daily` → `IFSC Station`

**涉及文件**：`src/QGCApplication.cc`

修改 `QGCApplication::QGCApplication` 中 `applicationName` 的赋值（约 264-268 行）：

```cpp
// 修改前
#ifdef DAILY_BUILD
applicationName = QStringLiteral("%1 Daily").arg(QGC_APPLICATION_NAME);
#else
applicationName = QGC_APPLICATION_NAME;
#endif

// 修改后
#ifdef DAILY_BUILD
applicationName = QStringLiteral("IFSC Station");   // 不再追加 Daily
#else
applicationName = QStringLiteral("IFSC Station");   // 写死，不依赖 QGC_APPLICATION_NAME
#endif
```

> 说明：`QGC_APPLICATION_NAME` 在 `src/QGCApplication.cc` 顶部默认为 `"QGroundControl"`；直接写死 `IFSC Station` 可避免 Daily 后缀与原名叠加。
> 该名称同时影响操作系统任务栏 / 标题栏名称，以及内部 `QGCApplication.appName`（被 QML 多处使用）。

---

## 3. 主窗口 / 设置面板中版本号替换并居中

### 3.1 主窗口底部

**涉及文件**：`src/ui/MainRootWindow.qml`

定位 `selectToolDialog` 内部两个 `QGCLabel`（约 416 行）：

```qml
// 修改前
QGCLabel {
    id:                     versionLabel
    text:                   qsTr("%1 Version").arg(QGroundControl.appName)
    Layout.alignment:       Qt.AlignHCenter
}
QGCLabel {
    text:                   QGroundControl.qgcVersion        // 例如 v4.2.8
    Layout.alignment:       Qt.AlignHCenter
}

// 修改后
QGCLabel {
    id:                     versionLabel
    text:                   qsTr("IFSC Station")             // 去掉 "Version" 后缀
    Layout.fillWidth:       true                              // 撑满布局宽度
    Layout.alignment:       Qt.AlignHCenter
    horizontalAlignment:    Text.AlignHCenter                 // 内部水平居中
}
QGCLabel {
    text:                   "V1.0"                            // 替换原 v4.2.8
    Layout.fillWidth:       true
    Layout.alignment:       Qt.AlignHCenter
    horizontalAlignment:    Text.AlignHCenter
}
```

`QGCMouseArea`（彩蛋点击区）保留不动（`anchors.fill: parent` 仍覆盖整个版本区域）。

### 3.2 Application Settings 面板

**涉及文件**：`src/ui/preferences/GeneralSettings.qml`

定位同位置两个 `QGCLabel`（约 1116 行）：

```qml
// 修改前
QGCLabel { text: qsTr("%1 Version").arg(QGroundControl.appName); Layout.alignment: Qt.AlignHCenter }
QGCLabel { text: QGroundControl.qgcVersion;                       Layout.alignment: Qt.AlignHCenter }

// 修改后
QGCLabel { text: qsTr("IFSC Station"); Layout.fillWidth: true; Layout.alignment: Qt.AlignHCenter; horizontalAlignment: Text.AlignHCenter }
QGCLabel { text: "V1.0";               Layout.fillWidth: true; Layout.alignment: Qt.AlignHCenter; horizontalAlignment: Text.AlignHCenter }
```

> **踩坑提示**（详见第 10 节）：如果只加 `Layout.alignment: Qt.AlignHCenter` 而不加 `Layout.fillWidth: true` + `horizontalAlignment: Text.AlignHCenter`，label 文本不会真正居中，会贴在左侧。

---

## 4. 关闭 `New Version Available` 弹窗

**涉及文件**：`src/QGCApplication.cc`

定位版本检查回调 `_qgcCurrentStableVersionDownloadComplete`（约 839 行），用 `if (false)` 包裹整个处理块：

```cpp
// 修改前：原本会调用 _versionCheckDone(releaseJson) 然后弹窗
// 修改后：用 if(false) 包裹，使其在启动时不再触发升级提示
if (false) {
    // 原 errorMsg.isEmpty() / QFile versionFile / QJsonDocument / _versionCheckDone 等所有逻辑保留不动
}

sender()->deleteLater();
```

效果：启动时不再弹出 "You can download it from qgroundcontrol.com"。

---

## 5. 替换工具栏 / AppSettings / 飞行地图朝向 logo

| 引用点 | 资源路径 | 源文件 | 显示位置 |
|---|---|---|---|
| `src/ui/toolbar/MainToolBar.qml:70` | `/res/IFSC-StationLogoFull` | `resources/IFSC-StationLogoFull.svg` | 主工具栏左上角 logo |
| `src/ui/MainRootWindow.qml:402`（工具栏 Application Settings 按钮） | `/res/IFSC-StationLogoFull` | `resources/IFSC-StationLogoFull.svg` | 工具栏右下角 Application Settings 按钮图标 |
| `src/ui/MainRootWindow.qml`（AppSettings 顶栏） | `/res/QGCLogoWhite` | `resources/QGCLogoWhite.svg` | AppSettings 顶部小标题栏 logo |
| `src/FlightMap/FlightMap.qml:129`（无 GCS 朝向） | `/res/IFSC-StationLogoFull` | `resources/IFSC-StationLogoFull.svg` | 飞行地图中心 GCS 标识（gcsHeading 为 NaN） |
| `src/FlightMap/FlightMap.qml:129`（有 GCS 朝向） | `/res/IFSC-StationLogoArrow` | `resources/IFSC-StationLogoArrow.svg` | 飞行地图中心 GCS 朝向箭头（gcsHeading 有效时旋转） |
| `src/AutoPilotPlugins/APM/APMFollowComponent.qml:353` | `/res/IFSC-StationLogoArrow` | `resources/IFSC-StationLogoArrow.svg` | APM 跟随模式下的 GCS 标识 |

> 五个资源别名都在 `qgcresources.qrc` 中以 alias 注册（详见第 12 节）。`IFSC-StationLogoArrow` 是 2026-07-22 由原 `QGCLogoArrow` 改名而来：保留原 4 顶点凹四边形箭头外形（顶 (36,2) / 右下 (71,71) / 中凹 (36,54) / 左下 (1,71)），去掉内部的 Q 字母 (`path6-4` + `path8`/`path10`/`path12-3` + `rect4` 白色圆角背景) 和两翼白色三角形 (`path3789`/`path3791`)，所有紫色 fill 统一改为 `#00427F` 实心，viewBox 保持 `0 0 72 72` 不变以保证尺寸兼容；`IFSC-StationLogoFull` 此前已存在（`QGCLogoFull` 改名）。
>
> **重命名规则**：重命名 SVG → 同步改 `qgcresources.qrc` 的 alias + file 路径 → 全局搜旧名替换引用点（推荐用 `grep -r "QGCLogoArrow" src/` 验证无残留）。

### 5.1 替换源 SVG

```bash
cp /path/to/your/icon_full.svg  resources/QGCLogoFull.svg
cp /path/to/your/icon_white.svg resources/QGCLogoWhite.svg
cp /path/to/your/icon_black.svg resources/QGCLogoBlack.svg
```

建议尺寸保持与原文件一致；白色透明背景适配深色工具栏。

### 5.2 触发 Qt 资源系统重新编译（**关键**）

Qt 资源 `.qrc` 将 SVG 嵌入二进制，`make` **不监听 `.svg` 的 mtime 变化**，单纯替换后 `make` 不会重新生成资源：

```bash
cd build_v428

# 触发 qrc 重新生成
touch qgcresources.qrc
touch IFSC-Station.qrc

# 删除已编译的 qrc 对象
rm -f qrc_qgcresources.o
rm -f qrc_IFSC-Station.o
```

### 5.3 重新编译

```bash
make -j$(nproc)
```

### 5.4 验证新图标已嵌入

```bash
python3 -c "
data = open('staging/IFSC-Station','rb').read() if __import__('os').path.exists('staging/IFSC-Station') else open('staging/QGroundControl','rb').read()
for f in ['../resources/QGCLogoWhite.svg','../resources/IFSC-StationLogoFull.svg','../resources/QGCLogoBlack.svg']:
    print(f, '->', 'OK' if open(f,'rb').read() in data else 'MISSING')
"
```

返回 `OK` 表示成功嵌入。

> **踩坑提示**（详见第 10 节）：必须 `touch qrc` + `rm qrc_*.o` 强制重编；只跑 `make` 不会重新嵌入。

---

## 6. 主界面飞行视图右上角永久显示两个 LOGO

**涉及文件**：`src/FlightDisplay/FlyViewWidgetLayer.qml`

### 6.1 把 PNG 注册进 Qt 资源系统

**涉及文件**：`qgcresources.qrc`

在 `<qresource prefix="/res">` 块**内部**（`</qresource>` 之前）添加：

```xml
<file alias="LOGO.png">resources/LOGO.png</file>
<file alias="IFSC_logo.png">resources/IFSC_logo.png</file>
```

放置 PNG 实体：

```bash
cp /path/to/LOGO.png      resources/LOGO.png
cp /path/to/IFSC_logo.png resources/IFSC_logo.png
```

> **踩坑提示**（详见第 10 节 #3）：必须把 `<file>` 写在 `<qresource>` 标签**内部**；曾误写在 `</RCC>` 外侧，导致 rcc 报 `Line 107 Column 31 [unexpected <FILE> tag]`。修复即把行挪到正确的 `<qresource>` 块内即可。

### 6.2 修改 FlyViewWidgetLayer.qml

在原 `MultiVehicleList` 之前插入一个 `Row`（约 100 行后）：

```qml
// IFSC Station: 永久显示两个 LOGO（与仪表盘等高、对齐右侧）
Row {
    id:                 _ifscLogos
    anchors.top:        instrumentPanel.visible ? instrumentPanel.top : parent.top
    anchors.right:      instrumentPanel.visible ? instrumentPanel.left : parent.right
    anchors.topMargin:  instrumentPanel.visible ? 0 : _toolsMargin
    anchors.rightMargin: _toolsMargin
    spacing:            ScreenTools.defaultFontPixelWidth
    z:                  QGroundControl.zOrderTopMost
    height:             instrumentPanel.visible ? instrumentPanel.height : ScreenTools.defaultFontPixelHeight * 6

    Image {
        id:             ifscLogoImage
        source:         "qrc:/res/IFSC_logo.png"
        fillMode:       Image.PreserveAspectFit
        smooth:         true
        height:         parent.height
    }

    Image {
        id:             logoImage
        source:         "qrc:/res/LOGO.png"
        fillMode:       Image.PreserveAspectFit
        smooth:         true
        height:         parent.height
    }
}
```

关键点：
- `source: "qrc:/res/..."` 而非 `file:///...`（详见第 10 节 #4）
- `anchors.top: instrumentPanel.top` + `height: instrumentPanel.height` 使 LOGO 始终与右侧仪表盘等高
- `anchors.right: instrumentPanel.left` 让 LOGO 对齐仪表盘左缘（即贴住主界面右上角）
- `instrumentPanel.visible` 三元判断处理仪表盘隐藏时的回退位置

### 6.3 强制重新编译（关键）

```bash
cd build_v428
touch ../qgcresources.qrc
rm -f qrc_qgcresources.o
make -j$(nproc)
```

### 6.4 验证 PNG 已嵌入

```bash
cd build_v428
python3 -c "
exe = open('staging/IFSC-Station','rb').read() if __import__('os').path.exists('staging/IFSC-Station') else open('staging/QGroundControl','rb').read()
for f in ['../resources/LOGO.png', '../resources/IFSC_logo.png']:
    print(f, '->', 'OK' if open(f,'rb').read() in exe else 'MISSING')
"
```

两个都应输出 `OK`。

---

## 7. 把 `brandingPurple` 调色板改成深蓝 `#00427F`

**涉及文件**：`src/QGCPalette.cc`

定位 88 行的 `brandingPurple` 默认值（4.2.8）：

```cpp
// 修改前
DECLARE_QGC_NONTHEMED_COLOR(brandingPurple,     "#4A2C6D", "#4A2C6D")
// 修改后
DECLARE_QGC_NONTHEMED_COLOR(brandingPurple,     "#00427F", "#00427F")
```

> 选定 `#00427F` 是因为 QGC 默认的 `mainStatusBGColor`（第 91 行）已是 `#00427F`，改完后整条工具栏的渐变两边将统一为深蓝，不再出现紫→灰过渡。

### 生效位置

- `src/ui/toolbar/MainStatusIndicator.qml:80` 的 `qgcPal.brandingPurple`——未连接飞行器时 logo 右侧的 `Disconnected` 状态条底色。

### 重新编译

修改在 C++ 源中，普通 `make` 即可自动重新编译：

```bash
cd build_v428
make -j$(nproc)
```

---

## 8. 任务栏 / 启动器 / 文件管理器图标的设置

### 8.1 修改 main.cc 中的 setWindowIcon

**涉及文件**：`src/main.cc`

定位约 376-379 行的 `#ifdef Q_OS_LINUX` 块：

```cpp
// 修改前
QApplication::setWindowIcon(QIcon(":/res/resources/icons/qgroundcontrol.ico"));

// 修改后
QApplication::setWindowIcon(QIcon(":/res/resources/icons/IFSC-Station.ico"));
```

> 不要再加 `QGuiApplication::setDesktopFileName("IFSC-Station")`——官方 QGC 上游**没有**这个调用，添加后会在某些桌面环境（如 KDE 5 / 部分 GNOME）导致 Activities 概览与任务栏图标不显示（详见第 10 节 #7）。

### 8.2 注册图标资源到 qrc

**涉及文件**：`qgcresources.qrc`

```xml
<file alias="IFSC-Station.png">resources/icons/IFSC-Station.png</file>
<file alias="IFSC-Station.ico">resources/icons/IFSC-Station.ico</file>
```

### 8.3 AppImage 内的图标部署

**涉及文件**：
- `deploy/IFSC-Station-start.sh`（= `AppRun`）
- `deploy/create_IFSC-Station_appimage.sh`
- `resources/icons/IFSC-Station.png`（**必须是 128x128 RGBA PNG**）

**核心做法（与官方 QGroundControl.AppImage 完全一致）**：

```sh
# AppRun (IFSC-Station-start.sh)
#!/bin/sh
HERE="$(dirname "$(readlink -f "${0}")")"

# hack until icon issue with AppImage is resolved
mkdir -p ~/.icons && cp "${HERE}/IFSC-Station.png" ~/.icons

"${HERE}/IFSC-Station" "$@"
```

`.desktop` 文件：

```ini
[Desktop Entry]
Type=Application
Name=IFSC-Station
GenericName=Ground Control Station
Comment=UAS ground control station
Icon=IFSC-Station
Exec=AppRun
Terminal=false
Categories=Utility;
```

`AppDir` 根目录需有：
- `IFSC-Station.png`（128x128 RGBA）
- `.DirIcon -> IFSC-Station.png`（软链，让文件管理器显示应用图标）

> **重要**（详见第 10 节 #5）：`IFSC-Station.png` **必须是 128x128 RGBA**！如果是大图（如 4262x4262），文件管理器 / GTK 图标主题 / Qt 都无法正常加载，表现为"任务栏 / 启动器 / 文件管理器都没有图标"。

---

## 9. AppImage 打包脚本 `create_IFSC-Station_appimage.sh` 使用说明

### 9.1 一次性构建 release

```bash
cd .
qmake IFSC-Station.pro -spec linux-g++ CONFIG+=release
make -j$(nproc) release
```

> QGC 4.2.8 默认 Makefile target 会输出到 `build_<ver>/staging/`。本书示例以 `build_v428/staging/` 为准。

### 9.2 重新打 AppImage

```bash
chmod +x deploy/create_IFSC-Station_appimage.sh
./deploy/create_IFSC-Station_appimage.sh \
    /path/to/qgroundcontrol \
    /path/to/build_v428/staging \
    /path/to/output
```

> **踩坑提示**（详见第 10 节 #6）：当 deploy 脚本简化后，**必须重新打包**！旧的 AppImage 内部仍然包含旧版 AppRun 和旧 PNG。

### 9.3 产物清单

打包结束后 `output/` 下应出现：

```
IFSC-Station.AppImage    ← 唯一产物，单文件 AppImage（约 200MB Debug，180MB Release）
```

### 9.4 关于 RPATH 与运行时库

脚本默认假设目标系统 **≥ GLIBC 2.14**（与上游相同）。已实测在 **Ubuntu 24.04** 干净镜像（默认 GNOME）上能正常启动运行。

### 9.5 `create_IFSC-Station_appimage.sh` 相对 `create_linux_appimage.sh` 的差异

`deploy/create_IFSC-Station_appimage.sh` 是**逐条改自上游** `deploy/create_linux_appimage.sh`。两份脚本同在 `deploy/` 下，可直接 `diff` 对照。下表是 IFSC-Station 相对原版**每一处的差异及其动机**：

| # | 位置（原版行号 → IFSC 版行号） | 原版 (`create_linux_appimage.sh`) | IFSC 版 (`create_IFSC-Station_appimage.sh`) | 动机 |
|---|---|---|---|---|
| 1 | 顶部注释（1 → 1-5） | （无项目名） | `# IFSC-Station AppImage 打包脚本 / 基于 QGroundControl 的 create_linux_appimage.sh 修改而来 / 用法: ./create_IFSC-Station_appimage.sh <IFSC-Station_src_dir> <build_release_dir> [output_dir]` | 明确文件归属，避免混用 |
| 2 | usage 错误信息（7 → 10-13） | `create_linux_appimage.sh QGC_SRC_DIR QGC_RELEASE_DIR` | `create_IFSC-Station_appimage.sh IFSC-Station_SRC_DIR IFSC-Station_RELEASE_DIR [OUTPUT_DIR]` | 命令名同步替换 |
| 3 | 默认值（13-18 → 18-23） | `APP_NAME=QGroundControl`、`BINARY=QGroundControl`、`START_SH=qgroundcontrol-start.sh`、`ICON=qgroundcontrol.png`、`ICON_NAME=QGroundControl` | `APP_NAME=IFSC-Station`、`BINARY=IFSC-Station`、`START_SH=IFSC-Station-start.sh`、`ICON=IFSC-Station.png`、`ICON_NAME=IFSC-Station` | 二进制与品牌名同步到 IFSC-Station |
| 4 | 缺少 `OUTPUT_DIR` 路径校验（31-33 → 37-39） | 接收第 3 个参数但缺省时直接当输出目录 | 在第 3 参为空时 `OUTPUT_DIR=$(readlink -f \`pwd\`)` 并打印 | 多打印了一行调试提示，便于 CI |
| 5 | `AppRun` 复制（63 → 67） | `cp qgroundcontrol-start.sh AppRun` | `cp IFSC-Station-start.sh AppRun` | 配套 IFSC-Station 自定义启动脚本 |
| 6 | `rsync` 注释（60 → 66） | `# copy QGroundControl release into appimage` | `# copy IFSC-Station release into appimage` | 仅注释变化 |

可随时用下面命令核对全部差异：

```bash
diff -u deploy/create_linux_appimage.sh deploy/create_IFSC-Station_appimage.sh | less
```

---

## 10. 复现过程中遇到的问题与解决办法（重要）

> 本节是**原手册未记录、但实际复现时一定会遇到**的 9 个问题，按发现顺序整理。

### #1 副 PNG 巨大（4262x4262 → 128x128）

**现象**：原 `IFSC-Station.png` 是 4262x4262 RGBA PNG（496KB）。打包进 AppImage 后：
- 文件管理器不显示图标（缩略图生成超时）
- 任务栏 / 启动器显示默认图标
- 即使 `~/.icons/IFSC-Station.png` 被正确复制，主题加载器也因尺寸过大而拒绝渲染

**根因**：freedesktop hicolor 主题规范期望应用图标 ≤ 256x256。GNOME / KDE 的图标主题加载器对超大 PNG 有 size cap（一般 1024x1024），超过即失败。

**解决**：用 PIL / ImageMagick 把 `IFSC-Station.png` 缩放到 **128x128 RGBA**（这是与官方 QGroundControl.AppImage 完全一致的尺寸）。原大图作为备份保存为 `resources/icons/IFSC-Station-4262x4262.png`。

```bash
python3 -c "
from PIL import Image
img = Image.open('IFSC-Station-big.png').convert('RGBA')
img.thumbnail((128, 128), Image.LANCZOS)
img.save('resources/icons/IFSC-Station.png')
"
```

### #2 替换 SVG logo 后 make 不会重编 qrc

**现象**：替换 `resources/IFSC-StationLogoFull.svg` 等 SVG 后跑 `make -j4`，工具栏 logo 还是旧的。
**根因**：qmake 生成的 Makefile 规则把 `qrc_qgcresources.o` 的依赖项写为 `qgcresources.qrc`，**不监听被引用文件（SVG/PNG）** 的 mtime 变化。所以即使 SVG 变了，make 也不会重编 qrc_*.o。

**解决**：手动强制触发重编：

```bash
touch qgcresources.qrc    # 让 qmake 觉得 qrc 变了
rm -f qrc_qgcresources.o  # 删除已编译的 qrc 对象
make -j$(nproc)            # 触发完整重编链
```

### #3 qrc 文件 `<file>` 写在 `</RCC>` 外面

**现象**：`make` 失败，rcc 报错：

```
RCC Parse Error: 'qgcresources.qrc' Line 107 Column 31 [unexpected <FILE> tag]
```

**根因**：新加的 `<file alias="LOGO.png">resources/LOGO.png</file>` 写错了位置，写在了 `</qresource>` 之外。

**解决**：qrc 严格嵌套——`<file>` 必须**在 `<qresource prefix="/res">` 与 `</qresource>` 之间**。打开 qrc 文件，找到正确的 `</qresource>` 闭合标签，把 `<file>` 行挪到它**之前**。

### #4 PNG 用 `file:///` 绝对路径

**现象**：开发时 `source: "file:///home/lu/qgroundcontrol/build_v428/staging/IFSC_logo.png"` 能显示，但 `make install` / AppImage 打包后丢失。

**根因**：绝对文件路径**不会**被 `make` 收集到 Qt 资源系统（qrc），只是运行时从磁盘读取。换机器/换目录/打包 AppImage 后绝对路径就失效了。

**解决**：把 PNG 放到 `resources/` 目录下，并在 `qgcresources.qrc` 注册，然后用 `qrc:/res/...` 协议路径：

```qml
// 错的
source: "file:///home/lu/qgroundcontrol/build_v428/staging/IFSC_logo.png"

// 对的
source: "qrc:/res/IFSC_logo.png"
```

### #5 AppImage 内 PNG 太大（参见 #1）

**现象**：打包后文件管理器 / 任务栏都没有图标。

**根因**：见 #1。

**解决**：用 128x128 版本。

### #6 改了 deploy 脚本但忘了重打包

**现象**：简化 `deploy/IFSC-Station-start.sh` 和 `deploy/create_IFSC-Station_appimage.sh` 后，跑 `./deploy/create_IFSC-Station_appimage.sh ...` 出现**`AppImage FUSE mount 失败`**（沙箱无 FUSE 权限）：

```
fuse: failed to open /dev/fuse: Permission denied
Cannot mount AppImage, please check your FUSE setup.
```

**解决**：

1. 不用 FUSE 挂载方式打包。先用 `appimagetool --appimage-extract` 解包：

```bash
cp $(which appimagetool) /tmp/appimagetool.AppImage
cd /tmp && /tmp/appimagetool.AppImage --appimage-extract
# 现在 /tmp/squashfs-root/AppRun 是 appimagetool 的真正二进制
```

2. 然后直接调用 squashfs 工具：

```bash
export PATH="/tmp/squashfs-root/usr/bin:$PATH"
export LD_LIBRARY_PATH="/tmp/squashfs-root/usr/lib:$LD_LIBRARY_PATH"
/tmp/squashfs-root/AppRun /path/to/IFSC-Station.AppDir /path/to/output/IFSC-Station.AppImage
```

3. 验证重新打包生效：

```bash
rm -rf /tmp/verify_new && mkdir /tmp/verify_new && cd /tmp/verify_new
./IFSC-Station.AppImage --appimage-extract
file squashfs-root/IFSC-Station.png   # 必须是 128x128 RGBA
cat squashfs-root/AppRun                # 应该是简化版（< 1000 字节）
```

### #7 多余的 `setDesktopFileName` 导致任务栏图标在某些 DE 上丢失

**现象**：本机 Ubuntu 24.04 + GNOME 上能看到任务栏图标，但**干净机器 KDE / 部分 GNOME** 上不显示。

**根因**：`QGuiApplication::setDesktopFileName("IFSC-Station")` 会设置 `_NET_WM_DESKTOP_FILE` 属性。某些桌面环境会从 `~/.local/share/applications/IFSC-Station.desktop` 查图标；如果该文件不存在或没装，**反而会覆盖** `setWindowIcon` 设置的 `_NET_WM_ICON`，导致任务栏显示通用占位符。

**解决**：完全照搬官方 QGC 上游——**只调用 `QApplication::setWindowIcon`**，不调用 `setDesktopFileName`：

```cpp
// 错的（会导致部分 DE 上图标丢失）
QApplication::setWindowIcon(QIcon(":/res/resources/icons/IFSC-Station.ico"));
QGuiApplication::setDesktopFileName("IFSC-Station");

// 对的（与官方 QGroundControl 4.2.8 完全一致）
QApplication::setWindowIcon(QIcon(":/res/resources/icons/IFSC-Station.ico"));
```

### #8 标签"居中"但文字不居中

**现象**：MainRootWindow.qml 和 GeneralSettings.qml 里加了 `Layout.alignment: Qt.AlignHCenter`，但版本号 label 文字仍贴在左边。

**根因**：`Qt.AlignHCenter` 只让**整个 item** 在父布局中居中，但 label 自身的文字（`text`）默认是左对齐的。如果 label 没撑满整个可用宽度，文字看起来就贴左。

**解决**：必须同时加 3 行：

```qml
QGCLabel {
    text:                   "IFSC Station"
    Layout.fillWidth:       true            // 撑满布局给的可用宽度
    Layout.alignment:       Qt.AlignHCenter // item 在父布局中居中
    horizontalAlignment:    Text.AlignHCenter // 文字在 item 内居中
}
```

### #9 工程文件改名后增量编译报 `undefined reference to qInitResources_qgroundcontrol_qmlcache`

**现象**：把工程文件 `qgroundcontrol.pro` / `qgroundcontrol.qrc` 改名为 `IFSC-Station.pro` / `IFSC-Station.qrc` 后，Qt Creator 增量编译到链接阶段报错：

```
/usr/bin/ld: /tmp/IFSC-Station.qJFHrj.ltrans0.ltrans.o: in function `_sub_I_65535_0.498022':
<artificial>:(.text.startup+0x1f0): undefined reference to `qInitResources_qgroundcontrol_qmlcache()'
collect2: error: ld returned 1 exit status
```

**根因**（两层叠加）：
1. **`mv` 改名会保留源文件原 mtime**。`IFSC-Station.qrc` 的时间戳仍是改名前的旧值（早于构建目录里旧的 `qmlcache_loader.cpp`），增量 `make` 据此认为 qrc 未变化，**不会重新生成 qmlcache loader**。
2. 构建目录里残留着旧 qrc 名生成的 qmlcache 产物（`qmlcache_loader.cpp/.o`、`qrc_qgroundcontrol_qmlcache.cpp/.o`、`qgroundcontrol_qmlcache.qrc`）。旧 `qmlcache_loader.o` 仍调用 `qInitResources_qgroundcontrol_qmlcache()`，而改名后 qmake 重新生成的 Makefile 已不再编译/链接定义该函数的 `qrc_qgroundcontrol_qmlcache.o` → 符号未定义。

**解决**：删除构建目录里所有旧 qrc 名的 qmlcache 残留产物，让 make 强制重新生成 loader：

```bash
cd <build 目录>   # 例如 build-qgroundcontrol-Desktop-Release
rm -f qmlcache_loader.cpp qmlcache_loader.o
rm -f qrc_qgroundcontrol_qmlcache.cpp qrc_qgroundcontrol_qmlcache.o
rm -f qgroundcontrol_qmlcache.qrc
make -j$(nproc)
```

qmake 会以新 qrc 名（`IFSC-Station.qrc`）重新调用 `qmlcachegen` 生成 `qmlcache_loader.cpp`（初始化函数变为 `qInitResources_IFSC_Station` / `qInitResources_IFSC_Station_qmlcache` 等新名），链接通过。

**后续注意事项**：`mv` 改名后若再遇到"改了源码但 make 不重编"类问题，优先怀疑 mtime——用 `stat -c '%y 文件'` 检查，必要时 `touch` 改名文件更新时间戳。

---

## 11. 关于 `custom-example/` 目录的取舍

QGC 4.2.8 官方 `custom-example/` 是一套独立 CustomPlugin 的示例（自定义 `QGCCorePlugin` 子类 + `paletteOverride()` 重写整套调色板 + `IFSC-Station.qrc` 整体替换）。完整二开流程需要：

- 在仓库根建立 `custom/` 目录（重命名 `custom-example/`）；
- 编写 `CustomPlugin.cc` / `CustomPlugin.h`，其 `paletteOverride()` 覆盖每个颜色键 4 个状态值；
- `IFSC-Station.pro` 中通过 `CustomBuild` 开关自动加载 `custom/*.qrc`，最终编出 `CustomQGroundControl` 二进制。

**我们的 IFSC-Station 不走这条路**，理由：

1. 项目根目录长期保持单 `QGroundControl` 二进制，避免维护两套 binary；
2. 我们所做的定制很少（仅 5 处色键、2 张 PNG、2 处文字），直接改 `QGCPalette.cc` / `FlyViewWidgetLayer.qml` 等量级更小；
3. 完全干净复现更简单——不需要拉起 custom-example 模板。

如果将来变动量增大（比如调色板整体换肤、应用图标全套自定义、动效深度定制），可以平滑切换到 `custom-example` 路径。

---

## 12. 整套改动文件清单

| 路径 | 状态 | 作用 |
|---|---|---|
| `src/main.cc` | 修改 | 任务栏图标：`qgroundcontrol.ico` → `IFSC-Station.ico` |
| `src/QGCApplication.cc` | 修改 | 窗口标题 = `IFSC Station`；关闭 `New Version Available` 弹窗 |
| `src/QGCPalette.cc` | 修改 | `brandingPurple` 由 `#4A2C6D` 改为 `#00427F` |
| `src/ui/MainRootWindow.qml` | 修改 | 主窗口底部版本号：label 改为 `IFSC Station` + `V1.0` 居中 |
| `src/ui/preferences/GeneralSettings.qml` | 修改 | App Settings 面板版本号改为 `IFSC Station` + `V1.0` 居中 |
| `src/FlightDisplay/FlyViewWidgetLayer.qml` | 修改 | 飞行视图右上角两个 Image：永久显示，与仪表盘等高、对齐右侧 |
| `qgcresources.qrc` | 修改 | 注册 `LOGO.png` / `IFSC_logo.png` / `IFSC-Station.png` / `IFSC-Station.ico` |
| `resources/IFSC-StationLogoFull.svg` | 修改 | 工具栏左上角 / 飞行地图朝向 logo |
| `resources/QGCLogoWhite.svg` | 修改 | AppSettings 顶栏 logo |
| `resources/QGCLogoBlack.svg` | 修改 | 备用 logo |
| `deploy/IFSC-Station-start.sh` | 新增 | AppRun：与 QGC 原版同构 |
| `deploy/create_IFSC-Station_appimage.sh` | 新增 | 打包脚本：6 处品牌名替换的等价微调版 |
| `resources/LOGO.png` | 新增 | 主界面右上角品牌 logo（必须 128x128+） |
| `resources/IFSC_logo.png` | 新增 | 主界面右上角 IFSC logo（必须 128x128+） |
| `resources/icons/IFSC-Station.png` | 新增 | AppImage 应用图标，**必须 128x128 RGBA** |
| `resources/icons/IFSC-Station-4262x4262.png` | 新增（备份） | 大图备份，**不要打包进 AppImage** |
| `resources/icons/IFSC-Station.ico` | 新增 | Windows 风格多尺寸 ICO（10 个尺寸 16-256），嵌入 qrc 用于 _NET_WM_ICON |
| `resources/icons/sizes/` | 新增 | 多尺寸 PNG 备份目录（16/22/24/32/48/64/96/128/256/512），**不打包** |
| `qgroundcontrol.pro` → `IFSC-Station.pro` | 改名 | 工程文件（`TARGET = IFSC-Station`）；shadow-build 检查、RESOURCES 引用同步（见第 14 节） |
| `qgroundcontrol.qrc` → `IFSC-Station.qrc` | 改名 | 主资源文件（`.pro`/CMake 引用同步） |
| `qgroundcontrol.pro.user` → `IFSC-Station.pro.user` | 改名 | Qt Creator 项目配置（保留原 build 目录引用） |

---

## 13. 复现检查清单

按顺序执行下列步骤，全部成功即视为复现完整：

- [ ] 1. 替换 `src/QGCApplication.cc` 中 `applicationName = QStringLiteral("IFSC Station");`
- [ ] 2. 关闭版本检查块（`if (false)` 包裹 `_qgcCurrentStableVersionDownloadComplete`）
- [ ] 3. 修改 `src/main.cc` 的 `setWindowIcon` 路径为 `IFSC-Station.ico`
- [ ] 4. 修改 `src/ui/MainRootWindow.qml` 版本号两行 label（含 `Layout.fillWidth` + `horizontalAlignment`）
- [ ] 5. 修改 `src/ui/preferences/GeneralSettings.qml` 版本号两行 label（同样 3 行居中）
- [ ] 6. 替换 `resources/IFSC-StationLogoFull.svg` / `QGCLogoWhite.svg` / `QGCLogoBlack.svg`
- [ ] 7. 拷贝 `LOGO.png` 与 `IFSC_logo.png` 到 `resources/`，并在 `qgcresources.qrc` 的 `/res` 块**内部**注册
- [ ] 8. 修改 `FlyViewWidgetLayer.qml` 插入 `Row { ... }` 永久显示两个 LOGO，source 必须是 `qrc:/res/...`
- [ ] 9. 修改 `QGCPalette.cc` 的 `brandingPurple` 为 `#00427F`
- [ ] 10. 准备 128x128 RGBA 的 `resources/icons/IFSC-Station.png`（不是 4262x4262 大图）
- [ ] 11. 准备 10 尺寸的 `resources/icons/IFSC-Station.ico`，在 `qgcresources.qrc` 注册
- [ ] 12. `cd build_v428 && touch ../qgcresources.qrc && rm -f qrc_qgcresources.o && make -j$(nproc)`
- [ ] 13. 用 `deploy/create_IFSC-Station_appimage.sh` 重打 AppImage，确认输出目录里有 `IFSC-Station.AppImage`
- [ ] 14. 解包验证：`./IFSC-Station.AppImage --appimage-extract && file squashfs-root/IFSC-Station.png` 应为 128x128
- [ ] 15. 在另一台 **Ubuntu 24.04** 干净机器上双击 `IFSC-Station.AppImage`：窗口标题应为 `IFSC Station`，任务栏图标应为 `IFSC-Station`，主界面右上角两个 LOGO 均应显示，整条工具栏主题色为深蓝，文件管理器中 AppImage 的图标为 IFSC
- [ ] 16. （2026-08-05 工程文件改名后）确认 `qgroundcontrol.pro` / `qgroundcontrol.qrc` / `qgroundcontrol.pro.user` 已改名 `IFSC-Station.*`；构建目录无 `qrc_qgroundcontrol*` / `qmlcache_loader.*` 残留（见第 10 节 #9）；`make` 链接通过、`staging/IFSC-Station` 正常产出

---

## 14. 工程文件改名（去 qgroundcontrol 化：`qgroundcontrol.pro` → `IFSC-Station.pro`）

> 2026-08-05 完成。目的：把工程级文件的命名统一到 `IFSC-Station`，与桌面端二进制（`.pro` 中 `TARGET = IFSC-Station`）及 AppImage 产物一致，避免对外沟通时被误读为"QGroundControl 套壳"。

### 14.1 改名清单

| 原文件名 | 新文件名 | 说明 |
|---|---|---|
| `qgroundcontrol.pro` | `IFSC-Station.pro` | 工程文件（qmake 入口）；`TARGET = IFSC-Station` 原本已是新名 |
| `qgroundcontrol.qrc` | `IFSC-Station.qrc` | 主资源文件 |
| `qgroundcontrol.pro.user` | `IFSC-Station.pro.user` | Qt Creator 项目配置（改名后保持原 build 目录引用，避免全量重编） |

### 14.2 同步更新的引用

- **`IFSC-Station.pro` 内部**：shadow-build 检查（`exists($${OUT_PWD}/IFSC-Station.pro)`）、错误消息、RESOURCES 两处 `$$PWD/IFSC-Station.qrc`（含 `CustomBuild` 分支的 `custom/IFSC-Station.qrc`）
- **构建脚本**：`build/linux/build_IFSC-Station.sh` / `build/linux/.build_IFSC-Station.sh` 的 `qmake ${SRC_DIR}/IFSC-Station.pro` 及注释；`/home/lu/Share/create_IFSC-Station_appimage.sh` 与 `deploy/create_linux_appimage.sh` 的源码目录 `.pro` 存在性检查
- **CMake**：`CMakeLists.txt` 中 `IFSC-Station.qrc` 路径（CMake 为备选构建路径，仅同步 qrc 引用）
- **CI**：`.github/workflows/*.yml`（6 个）、`.travis.yml`、`backup-Jenkinsfile`、`build_ios.sh`、`android_environment.sh`、`.vagrantconfig.yml`
- **其它**：`QGCExternalLibs.pri`（注释）、`custom-example/updateqrc.py`、`src/VideoReceiver/README.md`
- **文档**：本手册、`IFSC-Station_使用手册.md`、`IFSC-Station_Windows定制与打包手册.md`、`IFSC-Station_Ubuntu构建与打包手册.md` 中的 `qgroundcontrol.pro` / `qgroundcontrol.qrc` / `qrc_qgroundcontrol.o` 引用

### 14.3 构建验证

1. 改名后先用 Qt 5.15.2 在临时 shadow 目录验证工程文件可解析：`qmake /path/to/IFSC-Station.pro`（应 EXIT 0 并生成 Makefile，无"找不到 qgroundcontrol.qrc"类错误）
2. 再在既有 build 目录增量编译 + 链接，确认 `staging/IFSC-Station` 正常产出
3. 增量编译踩到的 `undefined reference to qInitResources_qgroundcontrol_qmlcache` 链接问题与解决见**第 10 节 #9**

### 14.4 未改动的部分（有意保留）

- 源码根**目录名**仍是 `qgroundcontrol`（如 `/home/lu/Share/qgroundcontrol`、Qt Creator 的 `build-qgroundcontrol-Desktop-Release`）——目录是源码/构建目录路径，专利与手册均按此引用，不随工程文件改名
- `qgcresources.qrc` / `qgcimages.qrc` 等 qrc 文件名（QGC 内部资源名，`.pro`/CMake 广泛引用，与产品身份无关）
- `QGCPostLinkCommon.pri` 的 post-link 仍复制 `deploy/qgroundcontrol-start.sh` / `qgroundcontrol.desktop` / `qgroundcontrol.png` 到 staging（这些文件仍在树内、不影响 AppImage 打包；如需统一可另行处理）
- 各上游 CI 中与构建产物名/镜像相关的其余 QGC 字样（仅同步了 `.pro` 路径引用）

---

附：本手册与 `deploy/create_IFSC-Station_appimage.sh` / `deploy/IFSC-Station-start.sh` 三处文件配套更新；任何一处源码回退都必须同步这三份。

完整验证嵌入与正确性的脚本：

```bash
# 验证 logo SVG / PNG 已嵌入二进制
cd build_v428
python3 -c "
data = open('staging/IFSC-Station','rb').read() if __import__('os').path.exists('staging/IFSC-Station') else open('staging/QGroundControl','rb').read()
for f in ['../resources/QGCLogoWhite.svg','../resources/IFSC-StationLogoFull.svg','../resources/LOGO.png','../resources/IFSC_logo.png']:
    print(f, '->', ('OK' if open(f,'rb').read() in data else 'MISSING'))
"

# 验证 brandingPurple 已变 #00427F
strings staging/IFSC-Station | grep -E '^#0(0)?0427F' | head -1

# 验证 AppImage 产物（仅一个 .AppImage 文件）
ls -la output/IFSC-Station.AppImage

# 解包验证 PNG 尺寸
./IFSC-Station.AppImage --appimage-extract && file squashfs-root/IFSC-Station.png
```
