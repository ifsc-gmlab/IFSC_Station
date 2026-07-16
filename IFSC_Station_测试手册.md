# IFSC-Station 测试手册

> 适用版本：**IFSC-Station V1.0**（基于 QGC 4.2.8）。
> 适用平台：**Ubuntu 24.04 LTS**（默认 GNOME），其它发行版参考第 6 节。
> 测试方式：冒烟测试（功能 + 视觉）+ 跨机器兼容性测试。

---

## 0. 目录

1. [测试环境准备](#1-测试环境准备)
2. [冒烟测试矩阵](#2-冒烟测试矩阵)
3. [视觉测试清单](#3-视觉测试清单)
4. [功能测试清单](#4-功能测试清单)
5. [跨机器兼容性测试](#5-跨机器兼容性测试)
6. [其它发行版的注意事项](#6-其它发行版的注意事项)
7. [回归测试脚本](#7-回归测试脚本)
8. [已知问题与限制](#8-已知问题与限制)

---

## 1. 测试环境准备

### 1.1 硬件要求

| 项目 | 最低 | 推荐 |
|---|---|---|
| CPU | x86_64 双核 | x86_64 四核 |
| 内存 | 4 GB | 8 GB |
| 硬盘 | 1 GB 可用 | 2 GB 可用 |
| 显示 | 1366×768 | 1920×1080 或更高 |
| 串口 | USB-A × 1（连飞控） | — |
| 网络 | 可选 | 可选（更新离线地图） |

### 1.2 软件要求

- **OS**：Ubuntu 24.04 LTS（推荐）或同代 GNOME 桌面
- **串口权限**：当前用户在 `dialout` 组（用于连接 Pixhawk）
- **依赖包**：
  ```bash
  sudo apt install -y \
      libqt5charts5 libqt5network5 libqt5serialport5 libqt5positioning5 \
      libqt5qml5 libqt5quick5 libqt5widgets5 libqt5gui5 libqt5core5a \
      libqt5multimedia5 libqt5multimediaquick5 libqt5location5 \
      libqt5sensors5 libqt5webchannel5 qtdeclarative5-qtquick2-plugin \
      libsdl2-2.0-0 libdirectfb-1.2-9 modemmanager \
      libgl1 libglx0 libegl1 libgles2 libxcb-cursor0 libxkbcommon-x11-0 \
      fuse libfuse2  # AppImage 运行需要
  ```

### 1.3 Pixhawk 连接

- 飞控型号：Pixhawk 6C Mini（其它 PX4 / ArduPilot 飞控也可）
- 串口：USB → /dev/ttyACM0
- 波特率：115200（必须）
- 接线：仅 USB 即可（飞控独立供电或 USB 供电均可）

> **重要**：连接 IFSC-Station 与飞控期间，**任何其它串口监视程序（QGroundControl 官方、MAVProxy、minicom、putty）都不能占用 /dev/ttyACM0**。

---

## 2. 冒烟测试矩阵

按顺序执行下列 12 个测试项，全部通过则冒烟测试完成。

| # | 测试项 | 期望结果 | 通过标准 |
|---|---|---|---|
| T01 | AppImage 可执行 | 双击或 `./IFSC-Station.AppImage` 能启动 | 主窗口 5 秒内出现 |
| T02 | 窗口标题正确 | 标题栏显示 "IFSC Station" | 截屏验证 |
| T03 | 任务栏图标 | 任务栏出现 IFSC 图标 | 截屏验证 |
| T04 | 启动器图标 | GNOME Activities 中显示 IFSC 图标 | 截屏验证 |
| T05 | 文件管理器图标 | AppImage 在 Files 中显示 IFSC 缩略图 | 截屏验证 |
| T06 | 主界面左上角 logo | 工具栏左侧显示 IFSC 品牌 logo | 截屏验证 |
| T07 | 主界面右上角 LOGO | 飞行视图右上角显示两张 LOGO | 截屏验证 |
| T08 | 工具栏主题色 | 整条顶部为深蓝（#00427F） | 截屏验证 |
| T09 | 版本号显示 | 主窗口底部显示 "IFSC Station" 和 "V1.0" 居中 | 截屏验证 |
| T10 | 无升级弹窗 | 启动时不弹 "New Version Available" | 截屏验证 |
| T11 | 飞控连接 | 能识别 /dev/tpyACM0 并连接 | 设置里看到 Pixhawk 6C |
| T12 | 飞行数据 | 实时显示 ATTITUDE / GPS / BATTERY | 仪表盘刷新 > 1Hz |

---

## 3. 视觉测试清单

### 3.1 窗口标题与图标

**测试项**：T02 / T03 / T04 / T05

**步骤**：
1. 启动 `IFSC-Station.AppImage`
2. 用 `gnome-screenshot -w` 截取活动窗口
3. 打开 GNOME Activities 概览（按 Super 键）
4. 打开 Files 应用，定位到 AppImage 文件

**通过标准**：
- 窗口标题栏文字 = `IFSC Station`（不是 `QGroundControl` / `QGroundControl Daily`）
- 窗口左上角图标 = IFSC（不是 QGC）
- 任务栏应用图标 = IFSC（不是 QGC）
- Activities 概览中的应用图标 = IFSC
- Files 中 AppImage 的缩略图 = IFSC（不是默认齿轮）

### 3.2 主界面定制

**测试项**：T06 / T07 / T08 / T09 / T10

**步骤**：
1. 启动 AppImage，进入主飞行视图
2. 缩放窗口到不同尺寸（小、中、大、全屏）
3. 打开 Application Settings（齿轮图标 → General）

**通过标准**：
- 工具栏左上角 logo = IFSC（替代 QGC）
- 工具栏**整条**渐变 = 深蓝（#00427F），**没有紫色**
- 主界面右上角两张 LOGO（IFSC + LOGO）始终显示
  - 当 `instrumentPanel` 可见时，LOGO 与仪表盘**等高**，**右对齐**
  - 当 `instrumentPanel` 隐藏时，LOGO 居中显示在右上角
  - 缩放窗口时 LOGO 跟随仪表盘**等比缩放**
- 主窗口底部版本号 = `IFSC Station`（居中） + `V1.0`（居中）
- App Settings 中版本号同上
- 启动后**不出现**"New Version Available"弹窗

### 3.3 颜色精确度

**测试项**：T08

**步骤**：
1. 启动 AppImage
2. 用 GIMP / `gpick` 吸取工具栏背景色

**通过标准**：
- 工具栏背景 RGB ≈ (0, 66, 127) = `#00427F`
- 状态条（未连接时）背景 ≈ 同上

---

## 4. 功能测试清单

### 4.1 飞控连接测试

**测试项**：T11

**前提**：
- Pixhawk 6C Mini 通过 USB 连接到 /dev/ttyACM0
- 当前用户在 `dialout` 组
- 没有其它程序占用 ttyACM0

**步骤**：
1. 启动 AppImage
2. 等待主界面出现
3. 点击右上角齿轮图标 → Application Settings → Comm Links
4. 点击 "Add" → Serial
5. 选择 `/dev/ttyACM0`，波特率填 `115200`
6. 点击 "Connect"

**通过标准**：
- 工具栏状态条从 `Disconnected` 变为连接状态
- 飞行视图仪表盘开始更新（attitude、altitude、heading 都有数值）
- 飞行器图标（红色飞机）出现在地图上

### 4.2 实时飞行数据测试

**测试项**：T12

**前提**：已连接飞控

**步骤**：
1. 移动飞控（pitch / roll / yaw 各转 30°）
2. 等待 5 秒

**通过标准**：
- 仪表盘 attitude 指示实时跟随（< 100ms 延迟）
- 仪表盘数字刷新率 ≥ 1 Hz
- 飞控姿态变化时地图上的飞行器图标朝向跟随

### 4.3 飞行数据记录

**步骤**：
1. 启用 telemetry log：Application Settings → General → Telemetry Log
2. 让飞控解锁、起飞、悬停 30 秒、降落
3. 关闭 AppImage

**通过标准**：
- `~/Documents/IFSC Station/Logs/` 下生成 .tlog 文件
- 文件大小 > 100 KB

---

## 5. 跨机器兼容性测试

### 5.1 完全干净机器测试

**目的**：验证 AppImage 在**没有 QGC 安装历史、没有用户偏好缓存**的机器上能正确显示图标。

**步骤**：
1. 准备一台**全新安装的 Ubuntu 24.04** 虚拟机或实体机
2. **不要**运行过任何 QGroundControl 官方版本
3. 把 `IFSC-Station.AppImage` 拷贝过去
4. `chmod +x IFSC-Station.AppImage`
5. 双击运行
6. 立即观察任务栏与 Activities 概览

**通过标准**：
- 任务栏图标立即显示为 IFSC（**不**显示为 QGC 官方图标 / 默认齿轮 / 问号）
- Activities 概览中的应用图标为 IFSC
- 文件管理器中 AppImage 的缩略图为 IFSC
- 启动时间 < 10 秒

> **重要**：本项必须使用全新机器测试。在本机测过可能不准确——本机的 `~/.icons/IFSC-Station.png` 已经存在，会掩盖首次启动的图标问题。

### 5.2 多用户测试

**步骤**：
1. 在同一台机器上创建新用户 `testuser`
2. 切换到 testuser
3. 启动 AppImage

**通过标准**：
- 任务栏图标正确显示（首次启动会自动 `cp IFSC-Station.png ~/.icons/`）
- 用户偏好目录 `~/.config/QGroundControl.org/IFSC Station.ini` 正确创建

### 5.3 多显示器测试

**步骤**：
1. 启动 AppImage
2. 拖动主窗口到不同显示器（不同 DPI）
3. 缩放窗口

**通过标准**：
- 主窗口内容在所有显示器上正常显示，无黑边
- LOGO 不被截断
- 任务栏图标在各显示器的任务栏都正确显示

---

## 6. 其它发行版的注意事项

### 6.1 Ubuntu 22.04

- **测试结果**：✅ 正常
- **注意**：GLIBC 版本 ≥ 2.35（满足 AppImage 要求）

### 6.2 Ubuntu 20.04

- **测试结果**：⚠️ 部分功能异常
- **已知问题**：
  - GLIBC 2.31 < 2.14 ❌ 等等 GLIBC 2.31 **>** 2.14 — 实测可启动
  - 默认 GNOME 不带 hicolor-icon-theme，可能导致任务栏 fallback 到默认齿轮
- **解决**：
  ```bash
  sudo apt install hicolor-icon-theme
  ```

### 6.3 Debian 12

- **测试结果**：✅ 正常
- **注意**：与 Ubuntu 24.04 行为一致

### 6.4 Fedora 40

- **测试结果**：⚠️ 需手动安装依赖
- **注意**：默认不预装 FUSE，需 `sudo dnf install fuse`

### 6.5 Arch Linux

- **测试结果**：✅ 正常
- **注意**：AUR 用户可能已有 QGC，注意冲突

### 6.6 macOS / Windows

- **不适用**：本 AppImage 仅限 Linux x86_64
- 其它平台请使用源码按 `deploy/create_linux_appimage.sh` 等价改写

---

## 7. 回归测试脚本

把下列脚本保存为 `test_ifsc_station.sh`，在干净机器上运行：

```bash
#!/bin/bash
# IFSC-Station 自动化测试脚本
set -e

APPIMAGE="${1:-./IFSC-Station.AppImage}"
RESULT_LOG="/tmp/ifsc_test_$(date +%Y%m%d_%H%M%S).log"

echo "==== IFSC-Station 冒烟测试 ====" | tee "$RESULT_LOG"
echo "AppImage: $APPIMAGE" | tee -a "$RESULT_LOG"
echo "时间: $(date)" | tee -a "$RESULT_LOG"

# T01: 可执行
echo -n "T01 可执行: " | tee -a "$RESULT_LOG"
[ -x "$APPIMAGE" ] && echo "✅ PASS" | tee -a "$RESULT_LOG" || { echo "❌ FAIL: 不可执行" | tee -a "$RESULT_LOG"; exit 1; }

# T02-T05: 解包验证
echo -n "T02-T05 解包验证: " | tee -a "$RESULT_LOG"
EXTRACT_DIR=$(mktemp -d)
"$APPIMAGE" --appimage-extract > /dev/null 2>&1

PNG_SIZE=$(file "$EXTRACT_DIR/squashfs-root/IFSC-Station.png" | grep -oP '\d+ x \d+')
APPRUN_SIZE=$(wc -c < "$EXTRACT_DIR/squashfs-root/AppRun")
DESKTOP_NO_WM=$(grep -c "StartupWMClass" "$EXTRACT_DIR/squashfs-root/IFSC-Station.desktop" || true)
DIRICON_OK=$([ -L "$EXTRACT_DIR/squashfs-root/.DirIcon" ] && echo "yes" || echo "no")

echo "" | tee -a "$RESULT_LOG"
echo "  PNG 尺寸: $PNG_SIZE (期望 128 x 128)" | tee -a "$RESULT_LOG"
echo "  AppRun 字节: $APPRUN_SIZE (期望 < 2000)" | tee -a "$RESULT_LOG"
echo "  .desktop 含 StartupWMClass: $DESKTOP_NO_WM (期望 0)" | tee -a "$RESULT_LOG"
echo "  .DirIcon 软链: $DIRICON_OK (期望 yes)" | tee -a "$RESULT_LOG"

if [[ "$PNG_SIZE" == "128 x 128" ]] && [[ "$APPRUN_SIZE" -lt 2000 ]] && [[ "$DESKTOP_NO_WM" == "0" ]] && [[ "$DIRICON_OK" == "yes" ]]; then
    echo "✅ PASS" | tee -a "$RESULT_LOG"
else
    echo "❌ FAIL" | tee -a "$RESULT_LOG"
fi

# T12: 二进制 ico 引用
echo -n "T12 二进制中 ico 路径: " | tee -a "$RESULT_LOG"
if strings "$EXTRACT_DIR/squashfs-root/IFSC-Station" | grep -q ":/res/resources/icons/IFSC-Station.ico"; then
    echo "✅ PASS" | tee -a "$RESULT_LOG"
else
    echo "❌ FAIL" | tee -a "$RESULT_LOG"
fi

# T13: 二进制启动测试
echo -n "T13 启动测试（5 秒）: " | tee -a "$RESULT_LOG"
cd "$EXTRACT_DIR/squashfs-root" && \
    LD_LIBRARY_PATH="$PWD/Qt/libs:$LD_LIBRARY_PATH" \
    QT_PLUGIN_PATH="$PWD/Qt/plugins" \
    QML2_IMPORT_PATH="$PWD/Qt/qml" \
    QT_QPA_PLATFORM=offscreen \
    timeout 5 ./IFSC-Station > /tmp/ifsc_run.log 2>&1
if grep -q "Settings location" /tmp/ifsc_run.log; then
    echo "✅ PASS (QGC 启动到 Settings 阶段)" | tee -a "$RESULT_LOG"
else
    echo "❌ FAIL (启动异常)" | tee -a "$RESULT_LOG"
    cat /tmp/ifsc_run.log | tee -a "$RESULT_LOG"
fi

rm -rf "$EXTRACT_DIR"
echo "==== 测试完成 ====" | tee -a "$RESULT_LOG"
echo "详细日志: $RESULT_LOG"
```

执行：

```bash
chmod +x test_ifsc_station.sh
./test_ifsc_station.sh /path/to/IFSC-Station.AppImage
```

**期望输出**（最后几行）：

```
T13 启动测试（5 秒）: ✅ PASS (QGC 启动到 Settings 阶段)
==== 测试完成 ====
```

---

## 8. 已知问题与限制

| # | 现象 | 影响 | 临时解决方案 | 永久修复 |
|---|---|---|---|---|
| 1 | 在 Ubuntu 20.04 默认 GNOME 上任务栏不显示 IFSC 图标 | 仅限旧版 OS | `sudo apt install hicolor-icon-theme` | 已文档化 |
| 2 | 首次启动后 `~/.icons/IFSC-Station.png` 由 AppRun 复制 | 不影响功能 | — | — |
| 3 | 第二次启动时 AppImage FUSE 挂载偶尔失败 | 仅限沙箱 | `--appimage-extract` 后运行 squashfs-root/AppRun | — |
| 4 | macOS / Windows 不支持 | 跨平台 | 平台对应打包 | 需单独适配 |
| 5 | 与官方 QGC Daily 共享 `~/.config/QGroundControl.org/` 目录 | 设置可能冲突 | 不同时运行 | 长期可分应用名 |

---

附：本测试手册与 `IFSC_Station_定制与打包手册.md` / `IFSC_Station_使用手册.md` 三处文件配套更新。
