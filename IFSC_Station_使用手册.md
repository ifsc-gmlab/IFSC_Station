# IFSC-Station 使用手册

> 适用版本：**IFSC-Station V1.0**（基于 QGroundControl 4.2.8 定制）。
> 适用平台：Ubuntu 24.04 LTS / Debian 12 / 其它 Linux 发行版（参考测试手册第 6 节）。
> 阅读对象：无人机操作员、任务规划员、系统集成工程师。

---

## 0. 目录

1. [产品简介](#1-产品简介)
2. [快速开始](#2-快速开始)
3. [界面总览](#3-界面总览)
4. [连接飞控](#4-连接飞控)
5. [飞行仪表盘](#5-飞行仪表盘)
6. [任务规划](#6-任务规划)
7. [遥测日志](#7-遥测日志)
8. [常用快捷键](#8-常用快捷键)
9. [常见问题 FAQ](#9-常见问题-faq)
10. [故障排除](#10-故障排除)

---

## 1. 产品简介

### 1.1 什么是 IFSC-Station

**IFSC-Station** 是基于开源地面站软件 **QGroundControl 4.2.8** 定制的无人机地面控制站，专为 IFSC（International Fire Service College）科研与训练任务设计。

主要定制点：

- **品牌化**：标题 / 启动器 / 文件管理器全替换为 IFSC 品牌
- **永久 LOGO**：主界面右上角永久显示两张 LOGO（与仪表盘等高、随缩放）
- **配色统一**：整条顶部工具栏深蓝（#00427F）
- **关闭升级检查**：启动时不弹"New Version Available"弹窗
- **单 binary 部署**：约 200 MB AppImage，免安装、可双击运行

### 1.2 主要功能

- ✅ 实时飞行仪表盘（姿态、高度、速度、航向、电池）
- ✅ 飞控连接（USB / TCP / UDP）
- ✅ 任务规划（航点、动作、地理围栏）
- ✅ 地图浏览（支持离线瓦片缓存）
- ✅ 视频流接收（UDP / RTSP）
- ✅ 遥测日志记录（.tlog）
- ✅ 参数编辑器
- ❌ 固件升级（已在定制版中简化）

### 1.3 系统要求

- **OS**：Ubuntu 24.04 LTS（推荐） / Debian 12 / 其它 Linux x86_64
- **依赖**：Qt 5.15 runtime（AppImage 自带）
- **飞控**：PX4 / ArduPilot 固件的飞控（Pixhawk 系列、Pixracer、Cube 等）
- **串口**：USB 2.0+（连飞控用）

---

## 2. 快速开始

### 2.0 前置准备

**首次部署**请先按 [IFSC_Station_安装与运行手册](IFSC_Station_安装与运行手册.md) 完成：

1. 用户加入 `dialout` 组（**必须重新登录**）
2. 移除 `modemmanager`（避免串口冲突）
3. 安装 FUSE 2 + Qt 5 运行时 + GStreamer + 图形库
4. AppImage 赋予执行权限

> 上游 QGC AppImage **不是**双击即用——必须先补齐系统依赖。本手册第 9 节 FAQ 列出常见错误。

### 2.1 安装与首次启动

1. **下载** `IFSC-Station.AppImage`
2. **赋予执行权限**：
   ```bash
   chmod +x IFSC-Station.AppImage
   ```
3. **双击运行**或在终端运行：
   ```bash
   ./IFSC-Station.AppImage
   ```
4. 等待主窗口出现（约 5-10 秒）

> **首次启动会做两件事**：
> 1. 在 `~/.icons/IFSC-Station.png` 写入图标（任务栏/启动器需要）
> 2. 在 `~/.config/QGroundControl.org/IFSC Station.ini` 写入用户偏好

> 💡 想让 AppImage 像普通应用一样出现在 GNOME Activities / KDE 启动器中，参考 [IFSC_Station_安装与运行手册](IFSC_Station_安装与运行手册.md) 第 5 节"桌面集成"。

### 2.2 连接飞控

1. 用 USB 线把飞控连接到电脑
2. 等待 3-5 秒（Linux 自动加载 cdc_acm 驱动）
3. 在 IFSC-Station 中点击右上角 **齿轮图标** → **Application Settings**
4. 选择 **Comm Links** 标签 → 点击 **Add** → **Serial**
5. 配置：
   - **Name**：`Pixhawk 6C Mini`（任意）
   - **Type**：`Serial`
   - **Port**：`/dev/ttyACM0`（按实际填写）
   - **Baud Rate**：`115200`（**必须**）
6. 点击 **OK** → 回到主界面 → 顶部齿轮旁点击 **Connect**

成功连接后，状态条会显示飞控姿态、卫星数、电池电压。

### 2.3 查看实时数据

主飞行视图（默认视图）从上到下分三区：

```
┌─────────────────────────────────────────┐
│  [工具栏]                                │
├─────────────────────────────────────────┤
│                                          │
│    [飞行地图]               [LOGO] [LOGO]│
│                                          │
│                                          │
├─────────────────────────────────────────┤
│  [姿态仪表]  [高度]  [速度]  [航向]      │
└─────────────────────────────────────────┘
```

- **顶部工具栏**：状态、连接、应用设置入口
- **中部地图**：实时位置 + 飞行轨迹 + 任务航点
- **右下 LOGO**：永久显示的品牌 LOGO（与右侧仪表盘等高）
- **底部仪表盘**：姿态 / 高度 / 速度 / 航向

---

## 3. 界面总览

### 3.1 顶部工具栏

从左到右：

| 位置 | 元素 | 作用 |
|---|---|---|
| 1 | **IFSC logo** | 品牌标识（替代 QGC 官方 logo） |
| 2 | **Disconnected / 飞控名** | 连接状态条，点击可快速连接 |
| 3 | **GPS / Battery / RC** | 实时状态指示 |
| 4 | **Message** | 系统消息（含告警） |
| 5 | **应用设置 ⚙** | 打开 Application Settings |
| 6 | **窗口控制** | 最小化、最大化、关闭 |

### 3.2 飞行视图（默认）

主视图，含三块：

#### 飞行地图
- **蓝色飞机图标**：当前位置
- **彩色航点**：规划的任务
- **紫色虚线**：规划航迹
- **实线**：已飞行轨迹
- **手势**：滚轮缩放、左键拖动、双击居中

#### 右侧仪表盘
- **姿态指示器**（人工地平仪）
- **高度 / 速度**（大字号）
- **航向**（罗盘）
- **卫星数** / **HDOP** / **VDOP**
- **电池电压** / **电流** / **剩余电量**

#### 右上角 LOGO
- 与仪表盘**等高**显示
- 窗口缩放时跟随等比缩放
- 即使仪表盘隐藏也会显示在右上角

### 3.3 顶部标签栏

| 标签 | 作用 |
|---|---|
| **Fly** | 飞行视图（默认） |
| **Plan** | 任务规划 |
| **Review** | 日志回放 |
| **Setup** | 飞控配置 / 传感器标定 / 固件 |
| **Application Settings** | 应用全局设置 |

### 3.4 Application Settings

按功能分组：

| 标签 | 内容 |
|---|---|
| **General** | 单位（公制/英制）、语言、遥测日志、视频流、自动连接 |
| **Comm Links** | 串口/TCP/UDP 链接管理 |
| **Offline Maps** | 离线瓦片下载与管理 |
| **MAVLink** | MAVLink 协议参数 |
| **Console** | 调试控制台 |
| **Video** | 视频源配置 |
| **Version** | 版本信息（显示 "IFSC Station V1.0"） |

---

## 4. 连接飞控

### 4.1 USB 串口连接（最常用）

**前提**：
- 当前用户在 `dialout` 组（Linux 串口权限）
- 飞控已通过 USB 连接到电脑
- 没有其它程序占用 /dev/ttyACM0

**步骤**：
1. 把飞控插入 USB
2. 验证设备识别：
   ```bash
   ls -l /dev/ttyACM*
   # 应显示：crw-rw---- 1 root dialout 166, 0 ... /dev/ttyACM0
   ```
3. 把用户加入 dialout 组（如未加入）：
   ```bash
   sudo usermod -a -G dialout $USER
   # 注销重新登录生效
   ```
4. 在 IFSC-Station 中：**Settings ⚙ → Comm Links → Add → Serial**
5. 填入 `/dev/ttyACM0` + 波特率 `115200` → OK
6. **Connect**

### 4.2 TCP / UDP 网络连接

用于：已通过数传电台 / Wi-Fi 桥接的飞控。

**步骤**：
1. **Settings ⚙ → Comm Links → Add → TCP**
2. **Server Address**：飞控 IP（如 `192.168.1.10`）
3. **Port**：`5760`（PX4 默认）
4. **OK → Connect**

### 4.3 多飞控并存

可同时保存多个 Comm Link 配置，用 Name 区分（如 "Pixhawk 机载"、"Simulator" 等）。

---

## 5. 飞行仪表盘

### 5.1 实时读数

成功连接后，仪表盘数字以 ≥ 1 Hz 刷新：

| 仪表 | 单位 | 含义 |
|---|---|---|
| 高度 | m / ft | 相对起飞点的垂直距离 |
| 速度 | m/s / knots | 水平地速 |
| 航向 | ° (0-360) | 机头朝向，正北为 0 |
| 姿态 | ° (pitch/roll) | 飞行器倾斜角度 |
| 电池 | V / % | 电压 + 剩余电量百分比 |
| GPS | sats / HDOP | 卫星数 + 水平精度因子 |
| 遥控 | % | 遥控器各通道百分比 |

### 5.2 颜色警告

- **绿色**：正常
- **黄色**：警告（如 GPS 卫星 < 8）
- **红色**：严重（如电池 < 20%、失联）

### 5.3 飞行模式显示

顶部状态条左侧显示当前飞控模式：

- **PX4**：`AUTO` / `POSCTL` / `STABILIZED` / `MANUAL` / `OFFBOARD` 等
- **ArduPilot**：`GUIDED` / `LOITER` / `AUTO` / `STABILIZE` 等

> 不同飞控固件可用模式不同。模式切换需通过遥控器，**不能**在 IFSC-Station 中切换。

---

## 6. 任务规划

### 6.1 创建新任务

1. 顶部切到 **Plan** 标签
2. 地图上点击 "**+**" 添加 Waypoint
3. 调整每个航点的：
   - 高度
   - 悬停时间
   - 飞行速度
   - 朝向
4. 点击 **Upload** 写入飞控

### 6.2 任务类型

- **Simple Mission**：航点序列
- **Structure Scan**：建筑扫描（Z 字形覆盖）
- **Corridor Scan**：带状区域扫描
- **Survey**：多边形区域扫描

### 6.3 地理围栏

限制飞行器不能越界（违反会自动返航）：

1. **Plan → GeoFence**
2. 选择 **Circle**（圆形）或 **Polygon**（多边形）
3. 在地图上点击绘制
4. **Upload**

---

## 7. 遥测日志

### 7.1 自动记录

默认开启：所有飞控 → 地面站的 MAVLink 消息都会记录到本地。

**日志位置**：
```
~/Documents/IFSC Station/Logs/*.tlog
```

### 7.2 回放

1. 顶部切到 **Review** 标签
2. 点击 **Load Log** 选择 .tlog 文件
3. 时间轴拖动 → 回放飞控历史数据

### 7.3 导出

.tlog 是二进制 MAVLink 日志，可用以下工具分析：

- **mavlogdump.py**（pymavlink 自带）
  ```bash
  mavlogdump.py --types=GPS,ATTITUDE ~/Documents/IFSC\ Station/Logs/flight_001.tlog
  ```
- **Mission Planner**（Windows 工具）
- **Flight Review**（在线工具 https://review.px4.io/）

---

## 8. 常用快捷键

| 操作 | 快捷键 |
|---|---|
| 缩放地图 | `Ctrl + +` / `Ctrl + -` |
| 居中飞行器 | `Ctrl + 0` |
| 全屏 | `F11` |
| 切换飞行视图 / 规划 | `Ctrl + Tab` |
| 截图（保存到 ~/Pictures） | `Ctrl + Shift + S` |
| 关闭主窗口 | `Ctrl + Q` |
| 打开 Application Settings | `Ctrl + ,` |
| 触发连接 | `Ctrl + Shift + C` |
| 触发断开 | `Ctrl + Shift + D` |

> 部分快捷键可能因 Linux 桌面环境而异。

---

## 9. 常见问题 FAQ

### Q1：双击 AppImage 没反应？

A：检查执行权限：
```bash
chmod +x IFSC-Station.AppImage
```

或在终端运行看错误：
```bash
./IFSC-Station.AppImage
```

### Q2：任务栏显示的是默认齿轮，不是 IFSC 图标？

A：
1. 关闭 AppImage
2. 重新启动一次（AppRun 会自动把图标复制到 `~/.icons/`）
3. 等待 2-3 秒，桌面环境刷新图标缓存
4. 必要时手动刷新：
   ```bash
   sudo update-icon-caches /usr/share/icons/*
   gtk-update-icon-cache -f ~/.local/share/icons/hicolor 2>/dev/null || true
   ```

### Q3：连接飞控时提示"Permission denied"？

A：当前用户不在 `dialout` 组：
```bash
sudo usermod -a -G dialout $USER
# 注销并重新登录
```

### Q4：连接飞控时提示"串口被占用"？

A：其它程序占用了 /dev/ttyACM0：
```bash
sudo lsof /dev/ttyACM0
# 找到进程后 kill 或关闭
```

### Q5：仪表盘数字不更新？

A：
1. 检查顶部状态条：是否已显示飞控模式？
2. 检查 MAVLink 心跳：是否显示心跳图标？
3. 重启串口连接
4. 重新插拔 USB

### Q6：主界面右上角 LOGO 看不到？

A：
1. 确认 IFSC-Station 版本是 V1.0（窗口标题应显示 "IFSC Station"）
2. 缩放窗口：LOGO 应该在仪表盘左缘
3. 仪表盘是否可见？若隐藏，LOGO 会显示在右上角其它位置

### Q7：如何升级到下一个版本？

A：IFSC-Station 不支持在线升级，请从 GitHub 仓库下载最新 AppImage 替换：
```bash
# 保留用户配置
mv IFSC-Station.AppImage IFSC-Station.AppImage.old
wget https://github.com/ifsc-gmlab/IFSC_Station/releases/latest/download/IFSC-Station.AppImage
chmod +x IFSC-Station.AppImage
```

### Q8：能在 Windows / macOS 上跑吗？

A：当前 IFSC-Station 仅打包了 **Linux x86_64 AppImage**。其它平台需要从源码按 `deploy/create_IFSC-Station_appimage.sh` 等价改写为 .dmg / .exe。

### Q9：如何重置所有设置？

A：
```bash
rm -rf ~/.config/QGroundControl.org/
# 重新启动 AppImage
```

### Q10：日志 / 地图缓存占太多空间？

A：
```bash
# 删除旧日志（保留地图缓存）
rm -rf ~/Documents/IFSC\ Station/Logs/

# 彻底清空缓存
rm -rf ~/.cache/QGCMapCache300/
```

---

## 10. 故障排除

### 10.1 AppImage 启动报错

#### `fuse: failed to open /dev/fuse: Permission denied`

**原因**：当前环境没有 FUSE 权限（如沙箱 / Docker）。

**解决**：用 `--appimage-extract` 解包运行：
```bash
./IFSC-Station.AppImage --appimage-extract
./squashfs-root/AppRun
```

#### `libQt5Core.so.5: cannot open shared object file`

**原因**：AppImage 内的 Qt 库路径未正确设置。

**解决**：手动指定环境变量：
```bash
cd /path/to/squashfs-root
export LD_LIBRARY_PATH="$PWD/Qt/libs:$LD_LIBRARY_PATH"
export QT_PLUGIN_PATH="$PWD/Qt/plugins"
export QML2_IMPORT_PATH="$PWD/Qt/qml"
./IFSC-Station "$@"
```

#### `GLIBC_2.XX' not found`

**原因**：系统 GLIBC 太老（< 2.14）。

**解决**：升级系统到 Ubuntu 22.04+ / Debian 12+。

### 10.2 飞控连接问题

#### `Failed to open serial port`

参考定制手册第 10 节 #1-#4，或使用 mavproxy 转发：
```bash
mavproxy.py --master=/dev/ttyACM0 --out=udp:127.0.0.1:14550
```
然后在 IFSC-Station 中添加 UDP 连接到 `127.0.0.1:14550`。

#### MAVLink 不兼容

IFSC-Station 4.2.8 兼容 PX4 ≥ 1.10 与 ArduPilot ≥ 4.0。飞控固件太老会导致部分功能异常。

### 10.3 视觉问题

#### 窗口内容超出屏幕 / 黑边

**解决**：
1. `Window → Adapt to Screen`
2. 手动重置缩放：`Ctrl + 0`

#### 字体显示异常

**解决**：
```bash
sudo apt install fonts-noto-cjk fonts-noto-color-emoji
```

### 10.4 性能问题

#### CPU 占用过高

- 关闭不需要的视图（视频流 / 日志回放）
- 降低 MAVLink 消息频率：Settings → MAVLink → Reduce update rate
- 用 Release 版本 AppImage（取代 Debug 版本）

#### 启动慢

- 首次启动会创建离线地图数据库（~30s 一次性）
- 删除 `~/.cache/QGCMapCache300/` 后重新启动会更慢

---

附：本使用手册与 `IFSC_Station_定制与打包手册.md` / `IFSC_Station_测试手册.md` 三处文件配套更新。
