# IFSC-Station Windows 定制与打包手册

> 适用源码版本：**QGroundControl 4.2.8**（`GIT_DESCRIBE = v4.2.8`，基于 mavlink/qgroundcontrol@v4.2.8 tag）
> 适用平台：**Windows 10 / 11 x64**（中文/英文均可，codepage 936 / 1252）
> 适用构建系统：**qmake + Qt 5.15.2 (msvc2019_64) + MSVC 2019 (16.x) + NSIS 3.08+**
> 项目根目录以下用 `.` 表示，所有相对路径均从仓库根目录出发
> 配套 Ubuntu 端手册：[IFSC-Station_Ubuntu构建与打包手册.md](IFSC-Station_Ubuntu构建与打包手册.md)（同一份源码，Linux 端如何构建 + 打包为 AppImage）

---

## 0. 目录

1. [概述](#1-概述)
2. [工具链与环境](#2-工具链与环境)
3. [改动文件清单（按类型）](#3-改动文件清单按类型)
4. [修改点详解（源码层）](#4-修改点详解源码层)
5. [新增资源详解](#5-新增资源详解)
6. [新增脚本详解](#6-新增脚本详解)
7. [干净机器从零复现步骤](#7-干净机器从零复现步骤)
8. [复现过程中遇到的问题与解决方案](#8-复现过程中遇到的问题与解决方案)
9. [复现检查清单](#9-复现检查清单)
10. [验证脚本](#10-验证脚本)

---

## 1. 概述

IFSC-Station 是基于 QGroundControl 4.2.8 的 Windows 定制分支，主要修改：

| 维度 | 原版 QGC | IFSC-Station |
|---|---|---|
| 应用名 | QGroundControl | IFSC-Station |
| 输出 EXE | QGroundControl.exe | IFSC-Station.exe |
| 安装器 | QGroundControl-installer.exe | IFSC-Station-installer.exe |
| 卸载器 | QGroundControl-Uninstall.exe | IFSC-Station-Uninstall.exe |
| 窗口标题 | QGroundControl Daily | IFSC-Station |
| 品牌色 | brandingPurple `#4A2C6D` | `#00427F`（与 mainStatusBGColor 统一） |
| 工具栏 Logo | QGCLogoFull.svg | IFSC-StationLogoFull.svg |
| 飞行地图 GCS 标识 | QGCLogoFull/Arrow.svg | IFSC-StationLogoFull/Arrow.svg |
| AppSettings 顶栏 | QGCLogoWhite/Black.svg | IFSC-StationLogoWhite/Black.svg |
| EXE 图标（任务栏） | qgroundcontrol.ico | IFSC-Station.ico |
| 飞行视图右上角 | 无 | 永久显示 GMLLogo + IFSCLogo |
| 升级弹窗 | 默认开启 | 关闭 |
| 主窗口 / 设置面板版本 | QGroundControl v4.2.8 | IFSC-Station V1.0（居中） |

**总改动量**：源码 14 处修改 + 9 个新资源文件 + 1 个新构建脚本。所有定制**不依赖** QGC 的 `custom-example/` CustomPlugin 模板，单 `IFSC-Station.exe` 即可独立运行。

---

## 2. 工具链与环境

### 2.1 必需组件

| 组件 | 版本 | 验证方式 |
|---|---|---|
| **Visual Studio 2019** | 16.10+（含 MSVC 14.29、`vcvars64.bat`） | `where cl` 返回 `cl.exe` |
| **Windows 11 SDK** | 10.0.22621+ | VS Installer 勾选 |
| **Qt 5.15.2** | `msvc2019_64` 组件 | `qmake -v` 返回 5.15.2 |
| **NSIS** | 3.08+ | `where makensis` 返回 `makensis.exe` |
| **Git**（可选） | 任意 | 仅用于打 tag 算版本号 |

**注意**：MSVC 2022 / 2025（17.x / 19.x）**不兼容** Qt 5.15.2 头文件，会触发 `qsggeometry.h(49)` C2144 等 ABI 问题。必须用 MSVC 2019 16.x。

**不需要**：GStreamer、CMake（QGC Windows 用 qmake）、Qwt、GTest。

### 2.2 推荐安装路径

```
D:\Qt\5.15.2\msvc2019_64\
E:\Microsoft Visual Studio 2019\VC\Auxiliary\Build\vcvars64.bat
C:\Program Files (x86)\NSIS\makensis.exe
```

非默认路径时，build 脚本支持环境变量覆盖（详见 §6.1）。

### 2.3 系统要求

- Windows 10 1809+ / Windows 11 x64
- 至少 8 GB 硬盘（构建产物 + 源码 ≈ 5 GB）
- 至少 8 GB 内存（jom 并行编译时）
- 首次构建约 30 分钟（生成 168 MB PCH + 全量编译）

---

## 3. 改动文件清单（按类型）

### 3.1 修改的源文件（18 个）

| # | 路径 | 关键改动 |
|---|---|---|
| 1 | `qgroundcontrol.pro` | `TARGET = IFSC-Station`；branding defines；`RC_ICONS` 改 IFSC-Station.ico |
| 2 | `QGCCommon.pri` | 添加 `/wd4264 /wd4819 /source-charset:utf-8 /execution-charset:utf-8` |
| 3 | `QGCPostLinkInstaller.pri` | NSIS `/XOutFile IFSC-Station-installer.exe` |
| 4 | `qgcresources.qrc` | alias `QGCLogoFull`/`QGCLogoArrow` → `IFSC-StationLogoFull`/`IFSC-StationLogoArrow`；新增 `IFSCLogo`/`GMLLogo`/`IFSC-Station.ico` |
| 5 | `qgcimages.qrc` | 同步别名改动 |
| 6 | `custom-example/qgcresources.qrc` | 同步别名改动（防止 CustomBuild 路径误用） |
| 7 | `src/main.cc` | `Q_OS_LINUX` 块改用 `IFSC-Station.ico`；**新增 `Q_OS_WIN` 块**让 alt-tab 窗口小图标也用 IFSC 图标 |
| 8 | `src/QGCApplication.cc` | applicationName 去掉 " Daily" 后缀；剥掉 7 个叠加的 UTF-8 BOM |
| 9 | `src/QGCApplication.h` | 静态成员 `static const int` → `static constexpr int`（解决 C4264） |
| 10 | `src/QGCPalette.cc` | `brandingPurple` `#4A2C6D` → `#00427F` |
| 11 | `src/Settings/AppSettings.cc` | 关闭 New Version Available 弹窗；版本号相关 |
| 12 | `src/comm/LogReplayLink.h` | `static const int` → `static constexpr int` |
| 13 | `src/FlightMap/FlightMap.qml` | L129 两个分支引用 `IFSC-StationLogoFull`/`IFSC-StationLogoArrow` |
| 14 | `src/AutoPilotPlugins/APM/APMFollowComponent.qml` | L353 引用 `IFSC-StationLogoArrow` |
| 15 | `src/ui/MainRootWindow.qml` | L402 `IFSC-StationLogoFull`；底部版本 label 改 "IFSC-Station" + "V1.0" 居中 |
| 16 | `src/ui/preferences/GeneralSettings.qml` | 同上，AppSettings 面板内 |
| 17 | `src/ui/toolbar/MainToolBar.qml` | L70 `IFSC-StationLogoFull` |
| 18 | `src/FlightDisplay/FlyViewWidgetLayer.qml` | 新增 `Row` 永久显示 GMLLogo + IFSCLogo，对齐仪表盘右侧 |

### 3.2 新增的资源文件（10 个）

| # | 路径 | 来源 | 用途 |
|---|---|---|---|
| 1 | `resources/IFSC-StationLogoFull.svg` | 改自 QGCLogoFull | 工具栏 / 飞行地图 GCS 标识 |
| 2 | `resources/IFSC-StationLogoWhite.svg` | 改自 QGCLogoWhite | AppSettings 顶栏（深色背景） |
| 3 | `resources/IFSC-StationLogoBlack.svg` | 改自 QGCLogoBlack | AppSettings 顶栏（浅色背景） |
| 4 | `resources/IFSC-StationLogoArrow.svg` | 改自 QGCLogoArrow | 飞行地图 GCS 朝向箭头（凹四边形） |
| 5 | `resources/IFSCLogo.png` | 课题组提供 | 飞行视图右上角品牌 LOGO #1 |
| 6 | `resources/GmlLogo.png` | 课题组提供 | 飞行视图右上角品牌 LOGO #2 |
| 7 | `resources/icons/IFSC-Station.ico` | 课题组图标（含 10 个尺寸 16-256） | Windows EXE 图标 / 任务栏 / alt-tab |
| 8 | `img_add/IFSC-StationBrandImage.png` | 课题组提供 | 品牌启动图（splash） |
| 9 | `src/FirmwarePlugin/PX4/IFSC-StationBrandImage.png` | 同上 | PX4 插件启动图 |
| 10 | `deploy/windows/installheader.bmp` | 改自默认页眉 | NSIS 安装器页眉（深蓝 `#00427F`） |

### 3.3 删除的文件（1 个）

| 路径 | 原因 |
|---|---|
| `resources/QGCLogoArrow.svg` | 重命名为 `IFSC-StationLogoArrow.svg`（去掉 Q 字符 + 改色 `#00427F`，保留凹四边形箭头外形） |

### 3.4 新增的脚本（1 个）

| 路径 | 用途 |
|---|---|
| `build/windows/build_IFSC-Station_installer.bat` | 一键 qmake + nmake + windeployqt + NSIS，自举 vcvars/Qt/NSIS 环境 |

---

## 4. 修改点详解（源码层）

### 4.1 应用名称与 EXE 文件名

**`qgroundcontrol.pro:30`**

```pro
# 原版
TARGET   = QGroundControl

# IFSC-Station
TARGET   = IFSC-Station
```

**`qgroundcontrol.pro:61-65`**

```pro
QGC_APP_NAME        = "IFSC-Station"
QGC_ORG_NAME        = "IFSC-Station"
QGC_ORG_DOMAIN      = "ifsc-station.local"
QGC_APP_DESCRIPTION = "IFSC Station ground control app for UAV"
QGC_APP_COPYRIGHT   = "Copyright (C) 2025 IFSC. All rights reserved."
```

**`qgroundcontrol.pro:52-53`**（Windows 资源）

```pro
WindowsBuild {
    RC_ICONS = resources/icons/IFSC-Station.ico
    CONFIG += resources_big
}
```

**联动效果**：
- qmake 直接输出 `staging/IFSC-Station.exe`（**不是复制**）
- windeployqt 自动部署 Qt DLLs 到 `staging\`
- NSIS 接收 `/DEXENAME=IFSC-Station` → 安装到 `C:\Program Files\IFSC-Station\IFSC-Station.exe`
- NSIS L90 `WriteUninstaller $INSTDIR\${EXENAME}-Uninstall.exe` → 自动产出 `IFSC-Station-Uninstall.exe`
- Windows 资源元数据（`QMAKE_TARGET_PRODUCT` / `_COMPANY` / `_DESCRIPTION`）全部从 `QGC_APP_NAME` 派生，自动带 "IFSC-Station"

### 4.2 窗口标题（去掉 "Daily"）

**`src/QGCApplication.cc:259-267`**

```cpp
if (_runningUnitTests) {
    applicationName = QStringLiteral("%1_unittest").arg(QGC_APPLICATION_NAME);
} else {
    // IFSC-Station: 去掉 " Daily" 后缀，保持窗口标题与 INI 文件名一致
    applicationName = QGC_APPLICATION_NAME;
}
```

**原版逻辑**：`#ifdef DAILY_BUILD` 时 app name 变成 `IFSC-Station Daily`。Daily 后缀原本是 QGC 给 daily/stable 并行安装做的隔离，对 IFSC-Station 无意义，去掉。

**副作用**：QSettings INI 路径从 `%APPDATA%\IFSC-Station\IFSC-Station Daily.ini` 变为 `%APPDATA%\IFSC-Station\IFSC-Station.ini`。

### 4.3 关闭升级弹窗

**`src/Settings/AppSettings.cc`** 中 `_qgcCurrentStableVersionDownloadComplete` 回调用 `if (false)` 包裹整个弹窗处理块（启动时不再触发 "You can download it from qgroundcontrol.com"）。

### 4.4 Logo 资源别名重命名

**`qgcresources.qrc:39-42, 58-60`**

```xml
<!-- 原版 -->
<file alias="QGCLogoFull">resources/QGCLogoFull.svg</file>
<file alias="QGCLogoArrow">resources/QGCLogoArrow.svg</file>

<!-- IFSC-Station -->
<file alias="IFSC-StationLogoFull">resources/IFSC-StationLogoFull.svg</file>
<file alias="IFSC-StationLogoArrow">resources/IFSC-StationLogoArrow.svg</file>
```

引用点同步改：
- `src/ui/toolbar/MainToolBar.qml:70` — `icon.source: "/res/IFSC-StationLogoFull"`
- `src/ui/MainRootWindow.qml:402` — `imageResource: "/res/IFSC-StationLogoFull"`
- `src/FlightMap/FlightMap.qml:129` — 两个分支分别引用 Full/Arrow
- `src/AutoPilotPlugins/APM/APMFollowComponent.qml:353` — `source: "/res/IFSC-StationLogoArrow"`

> 源码里有 16 处 `"QGroundControl"` 字符串（QML module 名、qmlRegisterUncreatableType 注册名、MAVLink telemetry 字段等），**全部不能改**——它们是 QML `import QGroundControl 1.0` 的协议名。

### 4.5 飞行视图右上角永久 LOGO

**`src/FlightDisplay/FlyViewWidgetLayer.qml`** 在 `MultiVehicleList` 之前插入 `Row`：

```qml
Row {
    id:                 _ifscLogos
    anchors.top:        instrumentPanel.visible ? instrumentPanel.top : parent.top
    anchors.right:      instrumentPanel.visible ? instrumentPanel.left : parent.right
    anchors.topMargin:  instrumentPanel.visible ? 0 : _toolsMargin
    anchors.rightMargin: _toolsMargin
    spacing:            ScreenTools.defaultFontPixelWidth
    z:                  QGroundControl.zOrderTopMost
    height:             instrumentPanel.visible ? instrumentPanel.height : ScreenTools.defaultFontPixelHeight * 6

    Image { source: "qrc:/res/IFSCLogo";   fillMode: Image.PreserveAspectFit; height: parent.height }
    Image { source: "qrc:/res/GMLLogo";   fillMode: Image.PreserveAspectFit; height: parent.height }
}
```

资源在 `qgcresources.qrc:62-63` 注册：
```xml
<file alias="GMLLogo">resources/GmlLogo.png</file>
<file alias="IFSCLogo">resources/IFSCLogo.png</file>
```

### 4.6 主窗口 / 设置面板版本号居中

**`src/ui/MainRootWindow.qml:416` 与 `src/ui/preferences/GeneralSettings.qml:1116`**

```qml
// 原版
QGCLabel { text: qsTr("%1 Version").arg(QGroundControl.appName); Layout.alignment: Qt.AlignHCenter }
QGCLabel { text: QGroundControl.qgcVersion;                       Layout.alignment: Qt.AlignHCenter }

// IFSC-Station
QGCLabel {
    text:                qsTr("IFSC-Station")
    Layout.fillWidth:    true
    Layout.alignment:    Qt.AlignHCenter
    horizontalAlignment: Text.AlignHCenter
}
QGCLabel {
    text:                "V1.0"
    Layout.fillWidth:    true
    Layout.alignment:    Qt.AlignHCenter
    horizontalAlignment: Text.AlignHCenter
}
```

**踩坑**：`Qt.AlignHCenter` 只让 item 整体在父布局中居中；label 自身文字默认左对齐。三行同时加（`Layout.fillWidth` + `Layout.alignment` + `horizontalAlignment`）才能让文字真正居中。

### 4.7 调色板统一为深蓝

**`src/QGCPalette.cc:88`**

```cpp
// 原版
DECLARE_QGC_NONTHEMED_COLOR(brandingPurple,     "#4A2C6D", "#4A2C6D")
// IFSC-Station
DECLARE_QGC_NONTHEMED_COLOR(brandingPurple,     "#00427F", "#00427F")
```

`#00427F` 与同文件 L91 的 `mainStatusBGColor` 完全一致。改完后 `MainStatusIndicator.qml:80` 的 `qgcPal.brandingPurple`（未连接飞行器时工具栏右侧 "Disconnected" 状态条底色）变成深蓝，整条工具栏颜色统一。

### 4.8 关闭升级弹窗

**`src/Settings/AppSettings.cc`** 中 `_qgcCurrentStableVersionDownloadComplete` 回调，用 `if (false)` 包裹整个弹窗块（详见旧手册 #4 节，但同样适用于 Windows）。

### 4.9 窗口图标（alt-tab + 任务栏）

**`src/main.cc:376-382`**

```cpp
#ifdef Q_OS_LINUX
    QApplication::setWindowIcon(QIcon(":/res/resources/icons/IFSC-Station.ico"));
#endif
#ifdef Q_OS_WIN
    // IFSC-Station: Windows 下运行时也设置窗口图标（与任务栏 EXE 图标区分，作用于 alt-tab/标题栏小图标）
    QApplication::setWindowIcon(QIcon(":/res/resources/icons/IFSC-Station.ico"));
#endif
```

**两套图标的区别**：
- `RC_ICONS`（pro 文件）→ 编进 EXE PE 头部，**任务栏**和**资源管理器**看到
- `setWindowIcon`（运行时）→ 运行时设置的窗口图标，**alt-tab 切换器**和**标题栏左上角**看到

两者必须都设才完整。

### 4.10 静态成员 const → constexpr

**`src/QGCApplication.h` 和 `src/comm/LogReplayLink.h`**

```cpp
// 原版（MSVC 16.x 报 C4264）
static const int kXXX = 123;

// IFSC-Station
static constexpr int kXXX = 123;
```

QGC 4.2.8 大量使用 `static const int kFoo = 42;` 作为 in-class initializer。MSVC `/WX` 把这条 "not a constant expression" 警告升为错误。`constexpr` 是 C++17 标准写法，零警告。

### 4.11 编译器 flags

**`QGCCommon.pri:93-99`**（Windows 段）

```make
QMAKE_CXXFLAGS_WARN_ON += /WX /W3 \
    /wd4005 \   # silence warnings about macro redefinition, these come from the shapefile code with is external
    /wd4290 \   # ignore exception specifications
    /wd4267 \   # silence conversion from 'size_t' to 'int', possible loss of data, these come from gps drivers shared with px4
    /wd4100 \   # unreferenced formal parameter - gst-plugins-good
    /wd4264 \   # in-class initializer for static data member is not a constant expression (MSVC 16.x)
    /wd4819 \   # 该文件包含不能在当前代码页中表示的字符（GBK 系统下 UTF-8 中文注释）
    /source-charset:utf-8 \   # 按 UTF-8 读源文件
    /execution-charset:utf-8   # 字符串字面量以 UTF-8 编码
```

最后 3 行是 IFSC-Station 新增。原版 Windows 段只有 5 个 `/wd`，加 `/wd4819 + /source-charset:utf-8` 是为了让 `main.cc` 里的中文注释（"下运行时也"）在中文系统（codepage 936）下能编译。

---

## 5. 新增资源详解

### 5.1 Logo SVG（4 个）

| 文件 | viewBox | 内容 | 用法 |
|---|---|---|---|
| `IFSC-StationLogoFull.svg` | 0 0 222 222 | 课题组品牌完整 LOGO（矢量） | 工具栏左上 / 飞行地图 GCS / AppSettings 按钮 |
| `IFSC-StationLogoWhite.svg` | 同上 | 白色版（深色背景适配） | AppSettings 顶栏深色场景 |
| `IFSC-StationLogoBlack.svg` | 同上 | 黑色版（浅色背景适配） | AppSettings 顶栏浅色场景 |
| `IFSC-StationLogoArrow.svg` | 0 0 72 72 | 原 QGCLogoArrow 凹四边形箭头外形（顶 (36,2) / 右下 (71,71) / 中凹 (36,54) / 左下 (1,71)），去掉内部 Q 字符和两翼白色三角形，fill `#00427F` 实心 | 飞行地图 GCS 朝向（gcsHeading 有效时） |

**重命名规则**：重命名 SVG → 同步改 `qgcresources.qrc` 的 alias + file 路径 → 全局搜旧名替换引用点（推荐 `grep -r "QGCLogoArrow" src/` 验证无残留）。

### 5.2 PNG / ICO 资源

| 文件 | 尺寸 | 格式 | 用法 |
|---|---|---|---|
| `resources/IFSCLogo.png` | ≥ 256×256 | RGBA PNG | 飞行视图右上角 LOGO #1 |
| `resources/GmlLogo.png` | ≥ 256×256 | RGBA PNG | 飞行视图右上角 LOGO #2 |
| `resources/icons/IFSC-Station.ico` | 16/22/24/32/48/64/96/128/256 | 多尺寸 ICO | Windows EXE 图标 / 任务栏 / alt-tab |

**ICO 制作**：用 ImageMagick / GIMP / 在线工具从一张大图批量导出多尺寸打包成 .ico。Windows ICO 格式需要尺寸齐全，否则缩放显示会糊。

### 5.3 NSIS 安装器页眉

**`deploy/windows/installheader.bmp`**：24-bit BMP，宽 4 的倍数（推荐 164×314 或 328×58），深蓝 `#00427F` 背景 + IFSC 字样。

**踩坑**：不能是 1/4/8-bit（NSIS 报 5040 Unsupported format）；不能是 RLE 压缩；不能 PNG 重命名（要真转）。

---

## 6. 新增脚本详解

### 6.1 `build/windows/build_IFSC-Station_installer.bat`

一键构建脚本，从任何 cmd / PowerShell 启动都能自举工具链：

| 步骤 | 作用 |
|---|---|
| 0. 解析路径 | 从脚本位置反推项目根 |
| 0a. 工具链定位 | 默认 `D:\Qt\5.15.2\msvc2019_64` / `E:\...\vcvars64.bat` / `C:\Program Files (x86)\NSIS`；可用 `QT_DIR` / `VCVARS` / `NSIS_DIR` 覆盖 |
| 0b. 自举环境 | 若 `cl` 不在 PATH 则 call vcvars；prepend Qt bin 和 NSIS bin；规避 `(x86)` 圆括号解析 |
| 1. 自检 | `where qmake` / `where cl` / `where makensis` |
| 2. 强制 qrc 重嵌入 | `copy /b qrc+,,` 触发 mtime 变化 |
| 2b. 清缓存 | 删 `QGroundControl_pch.{pch,obj,vc.pdb}` + 全部 `*.obj` / `*.pdb` / `*.pch` / `*.res` / `*.rcc` / `*.moc` / `*.idb` / **`qrc_*.cpp`** + `QGCLoggingCategory.obj` + `QGCApplication.obj` + `.qtc_clangd` |
| 3. qmake | `qmake qgroundcontrol.pro -spec win32-msvc CONFIG+=release CONFIG+=installer` |
| 4. nmake | 全量编译（PCH 重新生成 ~168 MB） |
| 5. windeployqt | 部署 Qt DLLs 到 `staging\` |
| 6. NSIS | `makensis /DDRIVER_MSI ... /DAPPNAME=IFSC-Station /DEXENAME=IFSC-Station /DORGNAME=IFSC-Station /XOutFile IFSC-Station-installer.exe` |
| 7. 验证 | 检查 `IFSC-Station-installer.exe` 是否存在；警告如果 `QGroundControl.exe` 仍存在（说明 qmake 没改 TARGET） |

**产物**：
- `build\staging\IFSC-Station-installer.exe` — NSIS 安装器
- `build\staging\IFSC-Station.exe` — 裸 EXE（可独立运行，已 windeployqt 完整）
- 不会出现 `QGroundControl.exe`（TARGET 改名后）

---

## 7. 干净机器从零复现步骤

### 7.1 准备源码

```bash
git clone https://github.com/mavlink/qgroundcontrol.git
cd qgroundcontrol
git checkout v4.2.8
```

或拷贝整个 `D:\gml\IFSC-Station\qgroundcontrol\` 目录（**不包含** `build\` 子目录；首次构建会自动生成）。

### 7.2 应用所有定制修改

按 §3 清单复制以下内容到对应路径：

1. **修改 `qgroundcontrol.pro`**：改 `TARGET`、`QGC_APP_NAME` 等 branding 段、`RC_ICONS` 段
2. **修改 `QGCCommon.pri`**：在 `QMAKE_CXXFLAGS_WARN_ON` 末尾加 `/wd4264 /wd4819 /source-charset:utf-8 /execution-charset:utf-8`
3. **修改 `QGCPostLinkInstaller.pri`**：改 `/XOutFile` 为 `IFSC-Station-installer.exe`
4. **修改 `qgcresources.qrc` / `qgcimages.qrc` / `custom-example/qgcresources.qrc`**：换 alias + 加新资源注册
5. **修改 `src/main.cc`**：两处 `setWindowIcon` 改用 `IFSC-Station.ico`
6. **修改 `src/QGCApplication.cc`**：剥 BOM；`applicationName = QGC_APPLICATION_NAME`；关闭版本检查
7. **修改 `src/QGCApplication.h` / `src/comm/LogReplayLink.h`**：`static const` → `static constexpr`
8. **修改 `src/QGCPalette.cc`**：`brandingPurple` 改 `#00427F`
9. **修改 `src/Settings/AppSettings.cc`**：版本检查回调包 `if (false)`
10. **修改 4 个 QML**：`MainToolBar.qml:70`、`MainRootWindow.qml:402` 和底部版本 label、`GeneralSettings.qml:1116`、`FlightMap.qml:129` 两分支、`APMFollowComponent.qml:353`
11. **修改 `src/FlightDisplay/FlyViewWidgetLayer.qml`**：插入永久 LOGO Row
12. **替换 4 个 SVG / 2 个 PNG / 1 个 ICO / 1 个 BMP** 到 `resources/`
13. **复制 `build/windows/build_IFSC-Station_installer.bat`** 到项目根的 `build/windows/`

### 7.3 安装工具链

按 §2.1 装好 4 个组件。

### 7.4 运行构建

```bat
:: 任意 cmd 或 PowerShell，不需要先开 VS 提示符
cd /d D:\path\to\qgroundcontrol
build\windows\build_IFSC-Station_installer.bat
```

**首次运行**：~30 分钟（生成 PCH + 全量编译）
**再次运行**：~5 分钟（仅修改文件相关 + qrc 重生成）

### 7.5 验证产物

```bat
dir build\staging\IFSC-Station-installer.exe
dir build\staging\IFSC-Station.exe
:: 不应存在 QGroundControl.exe
if exist build\staging\QGroundControl.exe echo [异常] TARGET 改名失败
```

### 7.6 测试安装

双击 `IFSC-Station-installer.exe` → 一路 Next → 安装到 `C:\Program Files\IFSC-Station\`

```
C:\Program Files\IFSC-Station\
├── IFSC-Station.exe
├── IFSC-Station-Uninstall.exe
├── Qt5Core.dll / Qt5Quick.dll / ... (windeployqt 自动部署)
├── IFSCStationBrandImage resources
└── platforms/  qml/  iconengines/  imageformats/  ... (Qt 插件)
```

启动后验证清单（见 §9 完整版）：
- [ ] 窗口标题 = "IFSC-Station"（无 Daily）
- [ ] 任务栏图标 = IFSC 自有图标
- [ ] alt-tab 切换器图标 = IFSC 自有图标
- [ ] 工具栏左上 = IFSC-StationLogoFull
- [ ] 飞行地图中心 = IFSC-StationLogoFull / 朝向箭头（带 gcsHeading 时）
- [ ] 飞行视图右上角 = GMLLogo + IFSCLogo 永久显示
- [ ] AppSettings 顶栏 = IFSC-StationLogoWhite
- [ ] 主窗口底部 = "IFSC-Station" + "V1.0" 居中
- [ ] 工具栏 Disconnected 状态条 = 深蓝
- [ ] 启动时无升级弹窗
- [ ] "IFSC Station" 开始菜单快捷方式
- [ ] 卸载器名字 = "IFSC-Station-Uninstall"

---

## 8. 复现过程中遇到的问题与解决方案

> 本节按发现顺序整理 10 个真实遇到的问题。所有"现象 → 根因 → 解决"都基于 §7 的实际执行。

### #1 7 个叠加的 UTF-8 BOM 在 `QGCApplication.cc` 头

**现象**：`qmake` 通过，但 `nmake` 报：

```
D:\Qt\5.15.2\msvc2019_64\include\QtQuick/qsggeometry.h(49): error C2144: 语法错误:"QSGGeometryData"的前面应有";"
D:\Qt\5.15.2\msvc2019_64\include\QtQuick/qsggeometry.h(49): error C4430: 缺少类型说明符 - 假定为 int
```

看似 Qt 头文件错，实际是**级联**。

**根因**：用某些编辑器保存 `QGCApplication.cc` 时误加了 7 个 UTF-8 BOM（`EF BB BF` × 7 = 21 字节）。MSVC 把前 21 字节当成无意义 token 吞掉，导致后续 `#include` 解析错误。

**解决**：用 `xxd` 或 PowerShell 验证文件前 32 字节不是 `EF BB BF`；如有，逐个 `sed -i '1s/^\xEF\xBB\xBF//' file.cc` 去掉。

**预防**：项目级 commit hook 检查 `*.cc` 头 3 字节。

### #2 预编译头（PCH）过期

**现象**：源码改了后第一次 build 失败，再 build 仍失败（同样的 qsggeometry.h 错误）。

**根因**：`QGroundControl_pch.pch`（168 MB）缓存了旧的宏/类型状态。nmake 看到 PCH 存在就复用，但新源码的 `#define` 已变。

**解决**：构建前清 PCH：

```bat
del build\QGroundControl_pch.pch
del build\QGroundControl_pch.obj
del build\QGroundControl.vc.pdb
```

**预防**：每次源码层修改（DEFINES / include 路径）前手动清。

### #3 `/WX` 把 C4819 升为 C2220

**现象**：

```
src\main.cc(1): error C2220: 以下警告被视为错误
src\main.cc(1): warning C4819: 该文件包含不能在当前代码页(936)中表示的字符
```

**根因**：`main.cc` L249 附近有中文注释（"下运行时也"）。中文 Windows 默认 codepage 936 = GBK，MSVC 读 UTF-8 源文件时遇到非 GBK 字符就 C4819；`/WX` 把它升为致命。

**解决**：两选一
1. 删中文注释（不优雅）
2. 加 `/wd4819 /source-charset:utf-8 /execution-charset:utf-8`（**推荐**，保留注释）

**预防**：在 `QGCCommon.pri` Windows 段预置这 3 个 flag。

### #4 `/LTCG` 链接的 PDB GUID 不一致 → LNK1318

**现象**：

```
LNK4020: "QGroundControl.vc.pdb"中的类型记录已损坏
fatal error LNK1318: 非意外的 PDB 错误
```

**根因**：shapelib / xz / QtLocationPlugin 等外部库的 `.obj` 在前一次构建时指向 PDB GUID A；这次 build 清了 PDB 但没清外部 `.obj`，GUID 不匹配，`/LTCG` 模式下严格校验。

**解决**：全量清 `.obj` / `.pdb` / `.pch`（不是只清 IFSC 自己的）：

```bat
del /s /q build\*.obj
del /s /q build\*.pdb
del /s /q build\*.pch
```

**预防**：build 脚本的步骤 2b 自动执行。

### #5 NSIS 路径含 `(x86)` 触发 cmd 解析错误

**现象**：

```
\NSIS was unexpected at this time.
```

**根因**：`if (exist "C:\Program Files (x86)\NSIS\...") (...) (...)` 里的 `(x86)` 被 cmd 当作命令分组分隔符。

**解决**：用 `goto` 风格代替 `if (...) (...)` 块：

```bat
if exist "%NSIS_DIR%\makensis.exe" goto :nsis_ok
echo [WARN ] NSIS not found
goto :nsis_done
:nsis_ok
set "PATH=%NSIS_DIR%;%PATH%"
:nsis_done
```

### #6 `IFSC-Station.exe` 是"复制"而非"直接输出"

**现象**：首次 `IFSC-Station.exe` 改了源码后还是旧版本；`QGroundControl.exe` 是新版本。

**根因**：原 build 脚本逻辑是"先编出 `QGroundControl.exe`，再 `copy` 一份叫 `IFSC-Station.exe`"。`copy` 用 `if not exist` 保护，第二次跑不覆盖。

**解决**：改 `qgroundcontrol.pro:30` 的 `TARGET = QGroundControl` → `TARGET = IFSC-Station`，qmake 直接输出 `IFSC-Station.exe`。脚本去掉 copy 段。

**副作用**：所有参数化的引用（windeployqt、NSIS、卸载器名）都通过 `$${TARGET}` 自动适配，**不需要**额外改。

### #7 qrc_*.cpp 不自动重新生成

**现象**：改了 `qgcresources.qrc`（alias 改名），`make` 不重编；产物里仍是旧 alias 的资源。

**根因**：qmake 生成的 Makefile 把 `qrc_qgcresources.o` 的依赖写为 `qgcresources.qrc`，**不监听被引用文件（SVG/PNG）的 mtime**。即使 alias 改了，qmake 也判断"qrc 没变"。

**解决**：构建前清 `qrc_*.cpp`：

```bat
del /s /q build\qrc_*.cpp
```

rcc 下次会被迫从新 qrc 重新生成。

**预防**：build 脚本步骤 2b 自动执行。

### #8 旧 EXE 占用 → post-link copy 失败

**现象**：

```
copy /y SDL2.dll staging
The process cannot access the file because it is being used by another process.
NMAKE : fatal error U1077: "copy": 返回代码"0x1"
```

**根因**：上次跑过 `IFSC-Station.exe`（或之前残留进程），仍持有 `staging\SDL2.dll` 的句柄。

**解决**：任务管理器结束所有 `IFSC-Station.exe` / `QGroundControl.exe` 进程，再跑脚本。

**预防**：构建前先关掉应用；或在脚本开头加 `taskkill /im IFSC-Station.exe /f`。

### #9 qsggeometry.h(49) 的真正根因是 BOM，不是 PCH

**现象**：清完 PCH 还报 qsggeometry.h(49) 错误。

**根因**：BOM（问题 #1）触发解析错误，PCH 只是让错误更早出现。

**解决**：先排查 BOM（xxd 看文件头），再清 PCH。两步必须都做。

**预防**：参考 #1。

### #10 MSVC 版本不兼容

**现象**：装好 Qt 后又能编译，几次 commit 后突然 qsggeometry.h(49) 错。

**根因**：从 MSVC 2019 切到 MSVC 2022/2025 编译（Qt Creator kit 默认会跟随 VS 最新版）。MSVC 17.x / 19.x 的 `<type_traits>` 与 Qt 5.15.2 头不兼容（ABI 差异）。

**解决**：Qt Creator → Tools → Kits → 选 `Desktop Qt 5.15.2 MSVC2019 64bit`（不是 MSVC2022）→ Build → Rebuild。

**预防**：项目级硬约束"Qt 5.15.2 + MSVC 2019 only"，在团队文档中明示。

---

## 9. 复现检查清单

按顺序执行下列步骤，全部成功即视为复现完整：

### 9.1 环境准备

- [ ] 1. 装 Visual Studio 2019 16.10+（勾选 "Desktop development with C++" + "Windows 10 SDK 10.0.19041+"）
- [ ] 2. 装 Qt 5.15.2 msvc2019_64 组件
- [ ] 3. 装 NSIS 3.08+（默认 `C:\Program Files (x86)\NSIS`）
- [ ] 4. 验证：`qmake -v` → Qt 5.15.2；`vcvars64 && cl /?` → MSVC 19.29+；`makensis /VERSION` → 3.08+

### 9.2 源码应用定制

- [ ] 5. `qgroundcontrol.pro` 改 TARGET + branding
- [ ] 6. `QGCCommon.pri` 加 `/wd4264 /wd4819 /source-charset:utf-8 /execution-charset:utf-8`
- [ ] 7. `QGCPostLinkInstaller.pri` 改 `/XOutFile`
- [ ] 8. 3 个 qrc 文件改 alias + 加新资源注册
- [ ] 9. `src/main.cc` 两处 setWindowIcon 改 IFSC-Station.ico
- [ ] 10. `src/QGCApplication.cc` 剥 BOM + 改 applicationName + 关闭版本检查
- [ ] 11. `src/QGCApplication.h` / `src/comm/LogReplayLink.h` `static const` → `static constexpr`
- [ ] 12. `src/QGCPalette.cc` brandingPurple 改 `#00427F`
- [ ] 13. `src/Settings/AppSettings.cc` 版本检查包 `if (false)`
- [ ] 14. 4 个 QML 文件改资源引用 + 版本 label
- [ ] 15. `src/FlightDisplay/FlyViewWidgetLayer.qml` 加永久 LOGO Row
- [ ] 16. 4 个 SVG / 2 个 PNG / 1 个 ICO / 1 个 BMP 替换到 `resources/`
- [ ] 17. 复制 `build/windows/build_IFSC-Station_installer.bat` 到项目

### 9.3 构建与验证

- [ ] 18. `cd /d D:\path\to\qgroundcontrol && build\windows\build_IFSC-Station_installer.bat`
- [ ] 19. 看到 `[2b] wiping stale PCH + .obj + .pdb + qrc_*.cpp ...`
- [ ] 20. 看到 `[1/3] qmake configure ...` `[2/3] nmake build ...` `[3/3] verify artifacts ...`
- [ ] 21. 看到 `[OK] Installer : ...\IFSC-Station-installer.exe`
- [ ] 22. 看到 `[OK] Bare EXE  : ...\IFSC-Station.exe`
- [ ] 23. **不应**看到 `QGroundControl.exe`（如果出现则 #6 未修复）

### 9.4 安装测试

- [ ] 24. 双击 `IFSC-Station-installer.exe`，安装到 `C:\Program Files\IFSC-Station\`
- [ ] 25. 启动后窗口标题 = "IFSC-Station"
- [ ] 26. 任务栏图标 + alt-tab 图标 = IFSC 自有图标
- [ ] 27. 工具栏左上 = IFSC-StationLogoFull
- [ ] 28. 飞行地图中心 = IFSC-StationLogoFull（gcsHeading NaN 时）或 IFSC-StationLogoArrow（有效时旋转）
- [ ] 29. 飞行视图右上角 = GMLLogo + IFSCLogo 永久显示
- [ ] 30. AppSettings 顶栏 = IFSC-StationLogoWhite
- [ ] 31. 主窗口底部 = "IFSC-Station" + "V1.0" 居中
- [ ] 32. 工具栏 Disconnected 状态条 = 深蓝 `#00427F`
- [ ] 33. 启动时无 "New Version Available" 弹窗
- [ ] 34. 开始菜单快捷方式 = "IFSC Station"
- [ ] 35. 控制面板卸载条目 = "IFSC-Station"（图标 + 名称）
- [ ] 36. 卸载器文件 = `IFSC-Station-Uninstall.exe`

---

## 10. 验证脚本

构建结束后，运行以下脚本确认所有定制都生效：

```bat
@echo off
set STAGING=D:\gml\IFSC-Station\qgroundcontrol\build\staging

echo === 1. EXE 命名 ===
if exist %STAGING%\IFSC-Station.exe         echo [OK] IFSC-Station.exe exists
if not exist %STAGING%\QGroundControl.exe   echo [OK] QGroundControl.exe does NOT exist
if exist %STAGING%\QGroundControl.exe       echo [FAIL] QGroundControl.exe should not be produced

echo.
echo === 2. 安装器 / 卸载器命名 ===
if exist %STAGING%\IFSC-Station-installer.exe   echo [OK] IFSC-Station-installer.exe exists

echo.
echo === 3. EXE 资源嵌入验证（用 7z / PowerShell）===
powershell -Command "$exe = Get-Content '%STAGING%\IFSC-Station.exe' -Encoding Byte -ReadCount 0; $found = @(); 'IFSC-Station','IFSC-StationLogoFull','IFSC-StationLogoArrow','IFSC-StationLogoWhite','IFSCStation','QGCLogoArrow','QGroundControl.exe' | ForEach-Object { $pattern = [System.Text.Encoding]::ASCII.GetBytes($_); $first = $exe.IndexOf($pattern,0); if ($first -ge 0) { Write-Host ('  [HIT ] {0,-30} offset 0x{1:X8}' -f $_,$first); } else { Write-Host ('  [MISS] {0,-30} not found' -f $_) } }"

echo.
echo === 4. 窗口图标嵌入 ===
powershell -Command "$bytes = [System.IO.File]::ReadAllBytes('%STAGING%\IFSC-Station.exe'); $ico = [System.IO.File]::ReadAllBytes('D:\gml\IFSC-Station\qgroundcontrol\resources\icons\IFSC-Station.ico'); if ($bytes -match $ico) { Write-Host '[OK] IFSC-Station.ico embedded' } else { Write-Host '[FAIL] IFSC-Station.ico NOT embedded' }"

echo.
echo === 5. 调色板验证 ===
powershell -Command "$bytes = [System.IO.File]::ReadAllBytes('%STAGING%\IFSC-Station.exe') -as [string]; if ($bytes -match '#00427F') { Write-Host '[OK] brandingPurple #00427F embedded' } else { Write-Host '[FAIL] #00427F NOT found' }; if ($bytes -match '#4A2C6D') { Write-Host '[FAIL] original purple #4A2C6D still present' } else { Write-Host '[OK] original purple removed' }"
```

每条都 `[OK]` 即视为构建完全成功。

---

## 附录 A：与上游 QGC 4.2.8 的关键差异

| 维度 | 上游 | IFSC-Station | 原因 |
|---|---|---|---|
| `TARGET` | QGroundControl | IFSC-Station | 直接输出品牌 EXE，避免复制歧义 |
| `QGC_APP_NAME` | QGroundControl | IFSC-Station | QSettings 路径 / 窗口标题 / 任务栏 |
| `RC_ICONS` | qgroundcontrol.ico | IFSC-Station.ico | Windows 资源管理器 / 任务栏 |
| `applicationName` 后缀 | `%1 Daily` | `%1` | 不再区分 daily/stable |
| `brandingPurple` | #4A2C6D | #00427F | 与 mainStatusBGColor 统一 |
| QGCLogoFull / Arrow 资源 | 默认 | 重命名为 IFSC-Station* | 品牌统一 |
| 飞行视图右上角 | 无 | GMLLogo + IFSCLogo Row | 课题组要求 |
| 升级弹窗 | 开启 | 关闭 | 闭源定制，不接上游版本 |
| NSIS 安装器名 | QGroundControl-... | IFSC-Station-... | 品牌统一 |
| 卸载器名 | QGroundControl-Uninstall | IFSC-Station-Uninstall | 品牌统一 |
| `/wd4264` | 无 | 有 | MSVC 16.x C4264 警告 |
| `/source-charset:utf-8` | 无 | 有 | 保留中文注释 |
| 构建脚本 | 无（用 Qt Creator） | `build_IFSC-Station_installer.bat` | 一键构建，CI 友好 |

## 附录 B：版本兼容性矩阵

| Qt | MSVC | qmake | 状态 |
|---|---|---|---|
| 5.15.2 | 2019 16.x | OK | **本项目使用** |
| 5.15.2 | 2022 17.x | ❌ | qsggeometry.h(49) C2144 ABI 不兼容 |
| 5.15.2 | 2025 19.x | ❌ | 同上 |
| 5.12.x | 2019 16.x | ⚠️ | QGC 4.2.8 要求 Qt 5.15 |
| 6.x | 任意 | ❌ | QGC 4.2.8 不支持 Qt 6 |

