# IFSC-Station 软件使用手册

> 适用版本：**IFSC-Station 1.0.0**（基于 QGroundControl 4.2.8 定制）
> 适用平台：**Windows 10 1809+ / Windows 11 x64**
> 安装包：`IFSC-Station-installer.exe`（约 18 MB）
> 项目主页：[QGroundControl 官方](http://qgroundcontrol.org)

---

## 0. 目录

1. [简介](#1-简介)
2. [使用前配置](#2-使用前配置)
3. [安装 IFSC-Station](#3-安装-ifsc-station)
4. [运行 IFSC-Station](#4-运行-ifsc-station)
5. [主要功能使用](#5-主要功能使用)
6. [二次开发指南](#6-二次开发指南)
7. [常见问题](#7-常见问题)
8. [获取帮助](#8-获取帮助)

---

## 1. 简介

IFSC-Station 是基于开源地面站软件 QGroundControl（QGC）4.2.8 的定制版本，专为 IFSC 课题组无人机测控与安全控制研究定制，主要修改：

- **品牌化**：应用名、窗口标题、任务栏图标全部替换为 IFSC 自有品牌
- **永久 LOGO 显示**：飞行视图右上角永久显示 GML 课题组 LOGO
- **配色统一**：工具栏 Disconnected 状态条改为深蓝 `#00427F`
- **关闭升级检查**：不再提示升级到上游 QGC 版本

底层功能（飞控连接、任务规划、地图、参数、视频、回放、固件升级等）**完全保留** QGC 4.2.8 的全部特性。

### 1.1 适用场景

- 无人机（PX4 / ArduPilot / 等）的地面监控
- 任务规划与航点编辑
- 实时遥测显示与参数调试
- 视频流接入（UVC / IP）
- 飞行日志回放与分析

### 1.2 不适用场景

- 商业载客无人机运营（请使用厂商授权版本）
- 与 IFSC-Station 协议不兼容的私有飞控

---

## 2. 使用前配置

### 2.1 硬件要求

| 组件 | 最低 | 推荐 |
|---|---|---|
| CPU | Intel i5 第 8 代 / AMD Ryzen 5 2500U | i7 第 10 代 / Ryzen 7 4700U |
| 内存 | 4 GB | 8 GB+ |
| 硬盘 | 500 MB 可用空间 | 1 GB+ |
| 显卡 | 支持 DirectX 11 | 独立显卡（用于视频/3D 地图） |
| USB | USB 2.0 ×1 | USB 3.0 ×1（高速遥测） |
| 网络 | 100 Mbps 以太网 / Wi-Fi | 1 Gbps / Wi-Fi 5+（视频流） |

### 2.2 软件环境

| 软件 | 要求 |
|---|---|
| 操作系统 | Windows 10 1809+ / Windows 11，x64 |
| 串口驱动 | CP210x / FTDI / CH340（按飞控数传模块型号装） |
| USB 驱动（Pixhawk） | 装 QGC 安装时自动装 `driver.msi`（FTDI-based） |
| .NET Framework | 4.7.2+（Win10 1903+ 自带） |
| Visual C++ 2015-2022 Redistributable | x64 必装（安装包已包含） |

### 2.3 网络配置

| 服务 | 端口 | 用途 |
|---|---|---|
| UDP MAVLink | 14550 / 14580 | 与飞控 / SITL 通信 |
| TCP MAVLink | 5760 | 与某些自驾仪通信 |
| Video (RTSP / UDP) | 5600 | 视频流接收（IP Camera） |
| Outbound HTTP | 443 | 地图瓦片下载（可关闭） |

**防火墙**：首次启动若弹防火墙询问，**全部勾选"允许"**。若误关，添加 `%PROGRAMFILES%\IFSC-Station\IFSC-Station.exe` 到防火墙白名单。

### 2.4 飞控连接方式

| 方式 | 硬件 | 推荐场景 |
|---|---|---|
| USB 数传 | USB-A → Micro-USB / USB-C，串口 115200 baud | 室内调试 / 固件升级 |
| 无线数传 | 2.4 GHz / 915 MHz 数传模块，串口或 UDP | 外场飞行 |
| Wi-Fi 数传 | ESP8266 / ESP32，UDP 14550 | 短距离低成本 |
| TCP/IP | 飞控连入局域网，TCP 5760 | PX4 SITL / 仿真 |
| Mission Planner 兼容 | 同 QGC 4.2.8 | 全部 |

### 2.5 飞控固件要求

- **PX4**：v1.10.0 ~ v1.14.0（推荐 stable）
- **ArduPilot**：Copter / Plane / Rover / Sub 4.0+
- **其它 MAVLink 兼容飞控**：v2.0 MAVLink 协议

> 飞控固件版本**不强制**与 IFSC-Station 版本对应——只要 MAVLink 协议版本兼容即可。

---

## 3. 安装 IFSC-Station

### 3.1 安装步骤

1. **下载安装器** `IFSC-Station-installer.exe`（18 MB）
2. **右键 → 以管理员身份运行**（非必须但推荐，避免后续驱动安装权限问题）
3. 安装器会显示深蓝页头（IFSC 品牌），点 **Next**
4. 选择安装路径（默认 `C:\Program Files\IFSC-Station\`，**不建议**改到非系统盘）
5. 勾选 **Create desktop shortcut** 和 **Start Menu shortcut**
6. 点 **Install** → 等待 1-2 分钟
7. 安装过程中会弹"是否安装 UAV 设备驱动"对话框（Mission Planner FTDI 驱动）→ 选 **Install**（仅首次安装需要）
8. 点 **Finish**

### 3.2 安装器做了什么

| 步骤 | 产物 |
|---|---|
| 复制文件 | `C:\Program Files\IFSC-Station\IFSC-Station.exe` |
| 复制 Qt 运行时 | `Qt5Core.dll` / `Qt5Quick.dll` / `Qt5Qml.dll` / ...（约 100 个） |
| 复制第三方 DLL | `SDL2.dll` / `libssl-1_1-x64.dll` / `libcrypto-1_1-x64.dll` |
| 复制 VC++ 运行时 | `msvcp140.dll` / `vcruntime140.dll` |
| 部署 QML 插件 | `platforms/` / `imageformats/` / `iconengines/` / `QtQuick/` 等子目录 |
| 创建卸载器 | `IFSC-Station-Uninstall.exe`（在同目录） |
| 写注册表 | `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\IFSC-Station` |
| 创建快捷方式 | 开始菜单 "IFSC Station" + 桌面图标 |
| 装设备驱动 | FTDI-based 数传驱动（仅首次） |

### 3.3 验证安装

- 开始菜单应有 **IFSC Station** 文件夹，包含 3 个快捷方式
  - IFSC Station（普通启动）
  - IFSC Station (GPU Compatibility Mode)（启动参数 `-angle`，用于显卡驱动问题）
  - IFSC Station (GPU Safe Mode)（启动参数 `-swrast`，纯软件渲染）
- 控制面板 → 程序 → 卸载程序，应有 "IFSC-Station" 条目
- 桌面图标应为深蓝 IFSC 圆形图标

### 3.4 卸载

**方式 A**：控制面板 → 卸载程序 → 找 "IFSC-Station" → 右键卸载
**方式 B**：开始菜单 → IFSC Station 文件夹 → 卸载
**方式 C**：双击 `C:\Program Files\IFSC-Station\IFSC-Station-Uninstall.exe`

卸载器会自动清理：所有安装文件、注册表项、开始菜单快捷方式。
**不会**删除：飞控参数、飞行日志（保存在 `%APPDATA%\IFSC-Station\`）。

> 若想完全清除所有数据，卸载后手动删 `%APPDATA%\IFSC-Station\`。

---

## 4. 运行 IFSC-Station

### 4.1 启动

**普通启动**：双击桌面图标或开始菜单快捷方式。首次启动约 3-5 秒。

**命令行启动**（高级用户）：

```bat
:: 默认
"C:\Program Files\IFSC-Station\IFSC-Station.exe"

:: 指定日志级别
"C:\Program Files\IFSC-Station\IFSC-Station.exe" --logging:full

:: 模拟器（无飞控时调试 UI）
"C:\Program Files\IFSC-Station\IFSC-Station.exe" --mocklink

:: 自定义 MAVLink 端口
"C:\Program Files\IFSC-Station\IFSC-Station.exe" --udp-port 14550

:: 完整参数列表
"C:\Program Files\IFSC-Station\IFSC-Station.exe" --help
```

### 4.2 主窗口布局

```
┌────────────────────────────────────────────────────┐
│ IFSC-Station                            [_][□][×] │  ← 标题栏
├─────┬──────────────────────────────────────────────┤
│ IFSC│ Not Ready  等待  ⚠  ⛏  📶  🔋 OK  ⊙        │  ← 工具栏
│Station                                              │
├─────┼──────────────────────────────────────────────┤
│ Plan│                                              │
│ 起飞│                                              │
│ 返航│            [地图 / 视频]                      │
│     │                                              │
│     │                  GML  IFSC                    │  ← 永久 LOGO
│     │                                              │
│     │                                              │
├─────┴──────────────────────────────────────────────┤
│ ↑--.--m  ↑0.0m/s  00:00:00  ⇆0.0m  →0.0m/s  $0.0m │  ← 飞行数据
│                                                    │
│            IFSC-Station                            │  ← 版本号（居中）
│                V1.0                                │
└────────────────────────────────────────────────────┘
```

- **左栏**：应用菜单（Plan / Fly / Review / Setup）
- **顶部工具栏**：飞行状态 + 飞控连接图标
- **主区域**：根据当前视图显示地图 / 视频 / 参数 / 日志等
- **右上角**：**永久显示** GML 课题组 LOGO + IFSC 课题组 LOGO（即使未连接飞控也显示）
- **底部**：遥测数据 + 版本号

### 4.3 关闭

- 主窗口右上角 × → 最小化到任务栏
- 任务栏图标 → 右键 → **Close** 真正退出
- 或在 Fly 视图点 **Home** 按钮 → Close 退出

> 关闭前若在下载地图瓦片，提示 "正在下载，是否取消"。

---

## 5. 主要功能使用

### 5.1 连接飞控

**自动连接**（推荐）：打开应用 → 插上数传 → 状态条变绿色 → 显示 "Ready to Fly"。

**手动连接**：
1. 工具栏右上 **设置齿轮** → Application Settings → Comm Links
2. 点 **Add** → 选类型（Serial / UDP / TCP）
3. 填参数：
   - Serial: 选择串口（如 COM3），波特率 115200
   - UDP: 监听端口 14550 或连服务器 IP:14550
   - TCP: 服务器 IP:5760
4. 点 **Connect**

### 5.2 飞行视图（Fly）

启动默认视图，主要内容：
- **中央地图**：飞机位置（带朝向箭头）、航点、Home 点
- **右上仪表盘**：高度、速度、航向、电池
- **顶部遥测条**：实时数据流
- **左下虚拟摇杆**：可切换（默认关闭，Setup 中开启）

**操作**：
- 鼠标拖动：平移地图
- 滚轮 / 双指捏：缩放
- 空格键：地图居中到飞机
- H 键：地图居中到 Home 点

### 5.3 任务规划（Plan）

1. 左栏点 **Plan**
2. 顶部工具栏选 **Mission / Survey / Structure Scan / Corridor Scan** 之一
3. 在地图上点 **Add Waypoint** 添加航点
4. 拖动航点调整位置
5. 右侧面板设每个航点的动作（拍照 / 悬停 / 改变高度等）
6. 点 **Upload to Vehicle** 上传到飞控

### 5.4 参数设置（Vehicle Setup）

1. 左栏点 **Vehicle Setup**
2. 选 **Firmware** → 看当前固件版本
3. 选 **Parameters** → 浏览 / 修改所有飞控参数
4. 选 **Sensors** → 校准加速度计、指南针、陀螺仪、水平
5. 选 **Radio** → 校准遥控器
6. 选 **Flight Modes** → 选 6 个通道对应的飞行模式
7. 选 **Power** → 电池参数
8. 选 **Safety** → 故障保护（FS 动作、地理围栏等）

### 5.5 飞行日志回放（Analyze）

1. 左栏点 **Analyze**
2. 顶部 **Log Download** 自动列出飞控上的日志 → 点 **Download**
3. 选中日志 → 顶部时间轴可拖动，地图显示飞行轨迹
4. 右侧 **MAVLink Inspector** 看每条消息的实时/历史值
5. 顶部 **GeoTag Page** 看带地理标记的照片

### 5.6 视频流（Fly 视图内）

1. Fly 视图 → 右上 **Video** 按钮（相机图标）
2. 首次进入会弹 **Video Settings**：
   - 选 **UVC**（USB 摄像头）或 **RTSP / UDP**（IP 摄像头）
   - 填 URL（如 `rtsp://192.168.1.100:554/stream`）
3. 点 **OK** → 视频流出现

### 5.7 自定义应用

**首选项持久化**：所有设置在 `%APPDATA%\IFSC-Station\IFSC-Station.ini`。删此文件重置所有偏好。

**配置文件**：
- 飞控参数：`%APPDATA%\IFSC-Station\Parameters\` （每架飞机一个子目录）
- 飞行日志：`%APPDATA%\IFSC-Station\logs\`（自动下载的）
- 任务规划：直接在 Plan 视图保存，存储在 `%APPDATA%\IFSC-Station\missions\`

---

## 6. 二次开发指南

> 本节面向需要修改 IFSC-Station 源码并重新构建的开发人员。

### 6.1 工具链准备

#### 6.1.1 必需组件

| 组件 | 版本 | 下载 |
|---|---|---|
| Visual Studio 2019 | 16.10+ | [visualstudio.microsoft.com](https://visualstudio.microsoft.com/vs/older-downloads/) |
| Windows 10 SDK | 10.0.19041+ | VS Installer 勾选 |
| Qt 5.15.2 | msvc2019_64 | [qt.io](https://www.qt.io/offline-installers) |
| NSIS 3.08+ | 3.08+ | [nsis.sourceforge.io](https://nsis.sourceforge.io/Download) |
| Git | 任意 | [git-scm.com](https://git-scm.com/) |
| 文本编辑器 | VS Code / Notepad++ | 任意（**勿用记事本**会加 BOM） |

#### 6.1.2 推荐安装路径

```
D:\Qt\5.15.2\msvc2019_64\
E:\Microsoft Visual Studio 2019\
C:\Program Files (x86)\NSIS\
D:\git\bin\
```

#### 6.1.3 验证

```bat
qmake -v                          :: 应返回 Qt 5.15.2
where cl                          :: 应指向 MSVC 14.29
where makensis                    :: 应返回 C:\Program Files (x86)\NSIS\makensis.exe
```

### 6.2 源码获取

```bash
git clone https://github.com/你的仓库/IFSC-Station.git
cd IFSC-Station
git checkout master
```

> 如果是从头开始，请先按 `IFSC-Station_Windows定制与打包手册.md` 应用所有定制。

### 6.3 项目结构

```
IFSC-Station\
├── IFSC-Station.pro            ← 入口 pro 文件
├── QGCCommon.pri                 ← 通用项目配置（含 Windows 编译器 flags）
├── QGCExternalLibs.pri           ← 外部库依赖
├── QGCPostLinkInstaller.pri      ← NSIS 打包后置命令
├── IFSC-Station.qrc            ← 主 qrc
├── qgcresources.qrc              ← 资源 alias（Logo/PNG/ICO 注册）
├── qgcimages.qrc                 ← 图像资源
├── src\                          ← C++ 源码
│   ├── main.cc                   ← 入口
│   ├── QGCApplication.cc         ← 应用初始化（含窗口标题）
│   ├── QGCPalette.cc             ← 调色板（含 brandingPurple）
│   ├── FlightMap\                ← 飞行地图 QML
│   ├── FlightDisplay\            ← 飞行显示 QML
│   ├── ui\                       ← 主窗口、工具栏
│   └── ...
├── resources\                    ← 资源（SVG / PNG / ICO）
├── deploy\windows\               ← NSIS 脚本
│   ├── nullsoft_installer.nsi    ← NSIS 打包配置
│   ├── installheader.bmp         ← 安装器页眉
│   └── IFSC-Station.ico          ← 安装器图标
├── build\windows\                ← 构建脚本
│   └── build_IFSC-Station_installer.bat
├── libs\                         ← 第三方库（shapelib / xz / SDL2 / OpenSSL）
├── IFSC-Station_Windows定制与打包手册.md
└── IFSC-Station_使用手册.md      ← 本文档
```

### 6.4 日常开发流程

#### 6.4.1 在 Qt Creator 中开发（推荐用于 UI 调试）

1. 打开 Qt Creator → File → Open File or Project → 选 `IFSC-Station.pro`
2. 选择 Kit：**Desktop Qt 5.15.2 MSVC2019 64bit**（**不是** MSVC2022）
3. Build → Rebuild Project "qgroundcontrol"（首次 ~30 分钟）
4. Run → Start Debugging（或 Ctrl+R）

> 改了 qrc 后 Qt Creator 通常能自动重新生成；但保险起见手动 Build → Rebuild。

#### 6.4.2 在命令行构建（推荐用于发布 / CI）

```bat
cd /d D:\path\to\IFSC-Station
build\windows\build_IFSC-Station_installer.bat
```

构建脚本会：
- 自举 vcvars64 / Qt / NSIS
- 清 PCH / obj / pdb / qrc_*.cpp
- qmake + nmake + windeployqt + NSIS
- 输出 `build\staging\IFSC-Station-installer.exe`

#### 6.4.3 增量编译（日常修改）

```bat
cd /d D:\path\to\IFSC-Station
build\windows\build_IFSC-Station_installer.bat
```

首次后脚本每次跑都只编译改动的文件，约 5-10 分钟。

#### 6.4.4 干净构建（重大修改后）

```bat
cd /d D:\path\to\IFSC-Station
rmdir /s /q build
build\windows\build_IFSC-Station_installer.bat
```

约 30 分钟（生成 PCH + 全量编译）。

### 6.5 常见修改场景

#### 6.5.1 改窗口标题 / 品牌名

编辑 `IFSC-Station.pro`：
```pro
QGC_APP_NAME = "新名字"
QGC_ORG_NAME = "新组织"
QGC_ORG_DOMAIN = "新域名"
```

或者 `src\QGCApplication.cc:267` 直接 hardcode。**不要**改 applicationName 加 " Daily" 后缀（参考 `IFSC-Station_Windows定制与打包手册.md` §8 #2）。

#### 6.5.2 替换 Logo

1. 准备新 logo（推荐 SVG 矢量）
2. 覆盖 `resources\IFSC-StationLogoFull.svg` 等
3. 重新构建（qrc 会自动重新嵌入）
4. 验证：`IFSC-Station.exe` 中能 `strings | grep IFSC-StationLogoFull`

#### 6.5.3 改主色

编辑 `src\QGCPalette.cc`，找对应的 `DECLARE_QGC_NONTHEMED_COLOR(name, light, dark)`，改十六进制色值。重新构建。

#### 6.5.4 加新 QML 页面

1. 在 `src\` 下建子目录（如 `src\MyFeature\`）
2. 创建 `MyFeature.qml`（用 `import QGroundControl 1.0`）
3. 在 `IFSC-Station.pro` 的 `HEADERS / SOURCES` 添加对应文件
4. 重新构建

#### 6.5.5 加新 C++ 类

1. 在 `src\MyFeature\` 下创建 `MyClass.h` 和 `MyClass.cc`
2. 在 `IFSC-Station.pro` 的 `HEADERS / SOURCES` 添加
3. 在合适的地方用 `qmlRegisterType<MyClass>("QGroundControl", 1, 0, "MyClass", ...)` 注册给 QML
4. 重新构建

### 6.6 调试技巧

#### 6.6.1 启动参数

```bat
:: 输出所有日志到控制台
IFSC-Station.exe --logging:full 2>&1 | tee debug.log

:: 模拟器模式（无需飞控）
IFSC-Station.exe --mocklink

:: 自定义数据目录（多版本并行测试）
IFSC-Station.exe --data-dir D:\test\data
```

#### 6.6.2 启用 QML 调试

设置环境变量：
```bat
set QT_LOGGING_RULES=*.debug=true
set QT_QML_DEBUG=1
```

#### 6.6.3 崩溃 dump

应用崩溃后 dump 文件在 `%LOCALAPPDATA%\QGCCrashDumps\`（与原 QGC 相同），用 WinDbg 或 VS 打开 `.dmp` 调试。

### 6.7 发布版本

#### 6.7.1 生成安装器

```bat
build\windows\build_IFSC-Station_installer.bat
```

产物：`build\staging\IFSC-Station-installer.exe`（约 18 MB）

#### 6.7.2 给最终用户分发

- 直接发 `IFSC-Station-installer.exe`（自包含，已包含 Qt 运行时）
- 用户双击安装，无需额外依赖（除 Windows 10/11 系统）
- 在 README 中注明：`https://github.com/你的仓库/IFSC-Station`（或内部 FTP）

#### 6.7.3 静默安装（企业部署）

```bat
IFSC-Station-installer.exe /S
```

静默安装到默认路径，不弹 UI。完成后检查 `%PROGRAMFILES%\IFSC-Station\` 是否存在。

#### 6.7.4 静默卸载

```bat
"C:\Program Files\IFSC-Station\IFSC-Station-Uninstall.exe" /S
```

### 6.8 提交代码规范

> **如果**你的团队把 IFSC-Station 当作长期维护项目，建议：

1. **分支策略**：
   - `master` — 稳定发布分支
   - `dev` — 日常开发
   - `feature/*` — 新功能
   - `fix/*` — bug 修复

2. **commit message 格式**：
   ```
   [类型] 简短描述
   
   详细说明（可选）
   
   类型: feat / fix / docs / refactor / build / ci
   ```

3. **代码审查清单**：
   - [ ] 改了 qrc / 资源 → 检查 alias 重命名
   - [ ] 改了 `IFSC-Station.pro` / `*.pri` → 跑全量 clean build
   - [ ] 改了 C++ 头 → 注意 `static const` → `static constexpr`（C4264）
   - [ ] 加新 QML → 用 `import QGroundControl 1.0`（不要硬编码字符串）
   - [ ] 改 SVG → 同步检查所有引用点

4. **PR 模板**：
   ```
   ## 改动概要
   - 改了什么
   - 为什么改
   
   ## 测试
   - 跑了哪些场景
   - 截图（如有 UI 改动）
   
   ## 关联 Issue
   - #xxx
   ```

---

## 7. 常见问题

### 7.1 启动相关

**Q: 双击图标无反应？**
A: 检查 `%APPDATA%\IFSC-Station\` 是否存在且可写。检查防火墙是否拦截。试用 GPU Compatibility Mode 启动。

**Q: 启动后白屏 / 卡死？**
A: 大概率显卡驱动问题。试用 **GPU Safe Mode** 启动（启动参数 `-swrast`）。或更新 NVIDIA / AMD / Intel 显卡驱动。

**Q: 启动后中文乱码？**
A: Windows 区域设置改成"中文（简体，中国）"。设置 → 时间和语言 → 区域 → 国家或地区。

### 7.2 飞控连接相关

**Q: 串口找不到？**
A: 设备管理器看是否有 `Ports (COM & LPT) → USB Serial Port (COMx)`。没有说明驱动没装，QGC 安装时已自动装 FTDI；若用 CP210x / CH340 需另外装驱动。

**Q: 连接成功但无数据？**
A: 波特率不匹配。常用 57600（APM）/ 115200（PX4）/ 921600（高速）。改 Comm Links 设置。

**Q: 反复断连？**
A: 数传模块信号差 / USB 接触不良 / 飞控固件不兼容。优先排查硬件。

### 7.3 地图相关

**Q: 地图显示空白 / 灰块？**
A: 网络问题导致瓦片下载失败。设置 → General → 关闭在线地图改用离线瓦片。

**Q: 飞行视图右上角 LOGO 不显示？**
A: 资源未嵌入。确认 `resources\IFSCLogo.png` 和 `resources\GmlLogo.png` 存在，且 `qgcresources.qrc` 有 `<file alias="IFSCLogo">` / `<file alias="GMLLogo">` 注册。重新构建并清 qrc_*.cpp。

### 7.4 编译相关（开发人员）

**Q: 报 `qsggeometry.h(49)` C2144 错误？**
A: MSVC 版本不兼容（用了 MSVC 2022+）。切到 MSVC 2019 16.x。

**Q: 报 LNK1318 PDB 错误？**
A: 旧 .obj 引用旧 PDB。删 build 目录全量重新构建。

**Q: 报 C4819 字符集错误？**
A: 源文件含 UTF-8 中文但系统是 GBK codepage。已在 QGCCommon.pri 加 `/wd4819 /source-charset:utf-8 /execution-charset:utf-8`，确认这三行存在。

**Q: 改完代码重新构建但 EXE 还是旧的？**
A: 三步检查：
1. 任务管理器结束 `IFSC-Station.exe` 进程
2. 删 `build\qrc_*.cpp`（qrc 没自动重生成）
3. 重跑 `build_IFSC-Station_installer.bat`

详细解决方案见 `IFSC-Station_Windows定制与打包手册.md` §8。

### 7.5 安装 / 卸载相关

**Q: 安装时报"权限不足"？**
A: 右键 → 以管理员身份运行。

**Q: 卸载后再次安装失败？**
A: 手动删 `C:\Program Files\IFSC-Station\` 和 `%APPDATA%\IFSC-Station\` 后重试。

**Q: 卸载器找不到？**
A: `C:\Program Files\IFSC-Station\IFSC-Station-Uninstall.exe`（不在控制面板"卸载程序"中？则可能装到了非默认路径，去那路径找）。

---

## 8. 获取帮助

### 8.1 自助资源

- **本手册**：完整使用 + 二次开发指南
- **定制与打包手册**：`IFSC-Station_Windows定制与打包手册.md`（开发人员构建问题）
- **QGC 官方文档**：[https://docs.qgroundcontrol.com](https://docs.qgroundcontrol.com)（底层功能 99% 与原版一致）
- **QGC 源码 GitHub**：[https://github.com/mavlink/qgroundcontrol](https://github.com/mavlink/qgroundcontrol)

### 8.2 联系方式

- 项目维护：[填入你的联系方式]
- Issue 提交：[填入你的 Git 仓库 URL]
- 内部群：[填入你的群号]

### 8.3 报告 Bug

提交 bug 时附上：
1. IFSC-Station 版本（主窗口底部 "V1.0"）
2. Windows 版本
3. 飞控型号 + 固件版本
4. 复现步骤
5. 错误截图
6. 日志（`%APPDATA%\IFSC-Station\logs\` 或 `--logging:full` 启动的 console 输出）

---

## 附录 A：快捷键参考

| 键 | 功能 |
|---|---|
| Space | 地图居中到飞机 |
| H | 地图居中到 Home 点 |
| Ctrl+N | 新建任务 |
| Ctrl+O | 打开任务 |
| Ctrl+S | 保存任务 |
| Ctrl+Q | 退出 |
| F1 | 帮助 |
| F11 | 全屏切换 |
| Tab | 在工具栏 / 地图 / 仪表盘间循环焦点 |
| Esc | 关闭当前弹窗 / 取消操作 |

## 附录 B：命令行参数

```bat
IFSC-Station.exe [options]

常用：
  --help                    显示完整帮助
  --version                 显示版本
  --logging:full            输出所有日志到 stderr
  --logging:Vehicle,Link    只输出 Vehicle 和 Link 类别
  --mocklink                启动模拟器（无需飞控）
  --data-dir <path>         自定义数据目录
  --settings-dir <path>     自定义 QSettings 目录

网络：
  --udp-port <port>         监听 UDP 端口（默认 14550）
  --tcp-port <port>         监听 TCP 端口（默认 5760）
  --no-mavlink              禁用 MAVLink（纯地图模式）

渲染：
  -angle                   OpenGL ES via ANGLE（兼容模式）
  -swrast                  纯软件渲染（安全模式）
  -qmljsdebugger=port:port  启动 QML 调试器

高级：
  --clear-settings          启动时清除所有设置
  --factory-reset           恢复出厂设置（含飞行日志、参数）
```

## 附录 C：文件位置速查

| 类别 | 路径 |
|---|---|
| 安装目录 | `C:\Program Files\IFSC-Station\` |
| 可执行文件 | `C:\Program Files\IFSC-Station\IFSC-Station.exe` |
| 卸载器 | `C:\Program Files\IFSC-Station\IFSC-Station-Uninstall.exe` |
| 用户配置 / 飞行日志 | `%APPDATA%\IFSC-Station\` |
| QSettings INI | `%APPDATA%\IFSC-Station\IFSC-Station.ini` |
| 崩溃 dump | `%LOCALAPPDATA%\QGCCrashDumps\` |
| 飞控参数缓存 | `%APPDATA%\IFSC-Station\Parameters\` |
| 飞行日志 | `%APPDATA%\IFSC-Station\logs\` |
| 离线地图瓦片 | `%APPDATA%\IFSC-Station\TerrainCache\` |
| 任务规划 | `%APPDATA%\IFSC-Station\missions\` |
| 屏幕截图（应用内） | `%USERPROFILE%\Pictures\` |

## 附录 D：与上游 QGC 的功能差异

| 功能 | 上游 QGC | IFSC-Station |
|---|---|---|
| 应用名 / 窗口标题 | QGroundControl Daily | IFSC-Station |
| 工具栏 Logo | QGC | IFSC-Station |
| 飞行地图 GCS | QGC | IFSC-Station |
| AppSettings Logo | QGC | IFSC-Station |
| 飞行视图右上 LOGO | 无 | GML + IFSC 永久显示 |
| 工具栏主色 | 紫→灰 | 深蓝统一 |
| 任务栏 / 资源管理器图标 | QGC | IFSC-Station |
| 升级弹窗 | 开启 | 关闭 |
| 输出 EXE | QGroundControl.exe | IFSC-Station.exe |
| 安装器 | QGroundControl-... | IFSC-Station-... |
| 卸载器 | QGroundControl-Uninstall | IFSC-Station-Uninstall |
| 飞控连接 | 全部 | 全部（未改） |
| 任务规划 | 全部 | 全部（未改） |
| 参数设置 | 全部 | 全部（未改） |
| 飞行日志 | 全部 | 全部（未改） |
| 视频流 | 全部 | 全部（未改） |
| 固件升级 | 全部 | 全部（未改） |
| MAVLink Inspector | 全部 | 全部（未改） |

**结论**：IFSC-Station 仅做品牌层定制，**全部业务功能与 QGC 4.2.8 一致**。QGC 官方文档 99% 直接适用。
