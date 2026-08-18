# IFSC-Station 网页版使用手册

> 适用版本：**IFSC-Station Web V1.1**（基于 QGC 4.2.8 源码的纯 Web 复刻）。
> 适用平台：**Windows 10/11、Windows Server 2016+、Ubuntu 20.04+**（任何能跑 Chrome 的系统）。
> 阅读对象：第一次使用网页版 IFSC-Station 的工程师 / 操作员 / 教学演示用户。

本文档配套 [开发手册](IFSC_Station_网页版开发手册.md)（实现原理） / [桌面版安装与运行手册](IFSC_Station_安装与运行手册.md) / [测试手册](IFSC_Station_测试手册.md)。

---

## 0. 目录

1. [网页版是什么](#1-网页版是什么)
2. [功能总览](#2-功能总览)
3. [使用前的准备](#3-使用前的准备)
4. [Windows 启动与连接飞控](#4-windows-启动与连接飞控)
5. [Ubuntu 启动与连接飞控](#5-ubuntu-启动与连接飞控)
6. [功能使用详解](#6-功能使用详解)
7. [控制器切换功能（IFSC_DIST_SW）](#7-控制器切换功能ifsc_dist_sw)
8. [常见问题](#8-常见问题)
9. [性能与限制](#9-性能与限制)

---

## 1. 网页版是什么

**IFSC-Station 网页版** 是桌面版 IFSC-Station 的纯 Web 复刻，使用 Chrome 浏览器的 **Web Serial API**（或 WebSocket 桥接）与飞控通信，**不需要安装桌面客户端**。只需一个 HTTP 服务 + 一个 Chrome 浏览器。

**典型使用场景**：

| 场景 | 为什么用网页版 |
|---|---|
| 教学演示 | 投影仪打开 Chrome 全屏即可，免安装 |
| 实验室调试 | 多台电脑共享同一飞控（轮流连接） |
| 嵌入第三方系统 | 用 iframe 嵌入到 Web 仪表盘 |
| 快速验证 | 不用装 libfuse2 / Qt5 / GStreamer |

---

## 2. 功能总览

| 功能 | 状态 | 说明 |
|---|---|---|
| 实时姿态显示 | ✅ | 人工地平仪、罗盘、偏航刻度条 |
| 位置显示 | ✅ | 高德真实地图 + 飞控位置 + HOME + 轨迹 |
| 速度显示 | ✅ | 地速 / 空速 / 升降速度 |
| 遥测状态 | ✅ | 电池、GPS 卫星数、RC 信号、飞行模式、解锁状态 |
| 地图交互 | ✅ | 缩放、居中飞行器、居中 GCS、GCJ-02 纠偏、瓦片持久缓存 |
| 参数编辑器 | ✅ | 完整复刻 QGC，搜索/读写/加载文件/重置/重启 |
| **控制器切换** | ✅ | **IFSC_DIST_SW：PID / LQR(INDI) / MPC 一键切换** |
| 日志下载 | ✅ | MAVLink FTP 拉取 `.ulg` 日志 |
| 传感器校准 | ✅ | 罗盘 / 陀螺仪 / 加速度计 / 水平 / 空速 |
| 遥控器校准 | ✅ | 8 通道实时显示 + 校准流程 |
| 重启飞控 / 重置校准 | ✅ | MAVLink 命令 |
| MAVLink 消息面板 | ✅ | 消息计数 + 最近 50 条系统消息 |
| 视频流 | ❌ | 需 GStreamer，Web 端未实现 |
| 航点上传 | ❌ | Plan 视图 UI 有，但 MISSION_PROTOCOL 上传未实现 |
| 固件升级 | ❌ | 网页版未实现（需桌面版） |

---

## 3. 使用前的准备

### 3.1 硬件

| 项目 | 推荐 |
|---|---|
| CPU / 内存 | x86_64 四核 / 8 GB |
| 浏览器 | Chrome 120+ / Edge 120+（**必须 Chromium 内核**） |
| 飞控 | Pixhawk 6C / 6C Mini（已验证），USB 数据线 |
| 波特率 | **115200**（Pixhawk 6C Mini 默认） |

### 3.2 浏览器要求（重要）

Web Serial 是 **Chrome 独占 API**：

- ✅ Google Chrome 89+ / Edge 89+ / Brave / Arc 等 Chromium 内核
- ❌ Firefox、Safari（不支持 Web Serial）

验证：地址栏输入 `chrome://version`，确认是 Chrome 120+。

### 3.3 Python（用于启动本地 HTTP 服务）

| 系统 | 安装 |
|---|---|
| Ubuntu 20.04+ | 默认已装（`python3 --version` 验证） |
| Windows / Server | https://www.python.org/downloads/ 下载，**勾选 "Add Python to PATH"** |

### 3.4 串口权限（仅 Ubuntu）

```bash
sudo usermod -aG dialout $USER
# 注销 → 重新登录（必须！）
groups | grep dialout   # 应看到 dialout
```

Windows / macOS 无需此步骤。

### 3.5 准备飞控

1. Pixhawk 通过 USB 连接电脑，上电
2. Ubuntu 检查：`ls /dev/ttyACM*`（应出现 `/dev/ttyACM0`）
3. **关闭 QGroundControl**（同时打开会争抢串口）

---

## 4. Windows 启动与连接飞控

### 4.1 启动网页版

**方式 A（推荐）：双击 `start.bat`**

1. 解压网页版目录（如 `C:\IFSC-web\`）
2. 双击 `start.bat`
3. 控制台显示 "IFSC-Station Web Starter"，浏览器自动打开 `http://localhost:8000/`

**方式 B：命令行**

```bat
cd C:\IFSC-web
start.bat
:: 换端口 / 局域网访问:
start.bat -p 9000
start.bat --bind 0.0.0.0
```

### 4.2 连接飞控（Web Serial 直连）

Windows 下用 **Web Serial 直连**即可，无需桥接：

1. 点击右上角 **Connect** 按钮 → 弹出连接面板
2. 连接类型选 **Serial (USB/UART)**
3. 波特率保持 **115200**
4. 点击 **连接** → Chrome 弹出原生端口选择框
5. 选择飞控设备（Windows 显示为 `USB Serial Device (COMx)`）
6. 等待右上角 `Link` 变绿、`Connected`、出现 `xxx Hz · xms` 跳动

**连接成功标志**：人工地平仪随飞控姿态转动、罗盘指针随偏航转动、底部遥测栏数据跳动。

---

## 5. Ubuntu 启动与连接飞控

### 5.1 启动网页版

**方式 A（推荐）：`start.sh`**

```bash
cd ~/IFSC-web
chmod +x start.sh
./start.sh
```

**方式 B：`start.py`**

```bash
cd ~/IFSC-web
python3 start.py
# 换端口 / 局域网访问:
python3 start.py -p 9000
python3 start.py --bind 0.0.0.0
```

> `start.py` 会自动：注册 SVG/字体 MIME、探测端口、打开浏览器、检测飞控串口并自动启动 WebSocket 桥接。

### 5.2 连接飞控（两种方式）

#### 方式 A：WebSocket 桥接（推荐，更稳定）

Pixhawk 6C 的 USB CDC 口对 Web Serial 直连会触发 USB 复位（报 "device has been lost"），**桥接模式更稳定**。

1. 安装依赖并启动桥接：

   ```bash
   pip3 install pyserial
   cd ~/IFSC-web
   python3 ws_bridge.py          # 默认 /dev/ttyACM0 @115200, WS 端口 8766
   # 或: python3 ws_bridge.py --port /dev/ttyACM0 --baud 115200 --ws 8766
   ```

2. 网页点 **Connect** → 连接类型选 **WebSocket Bridge**
3. URL 填 `ws://localhost:8766` → 点击 **连接**

> 提示：`start.py` 检测到飞控串口时会**自动**拉起 `ws_bridge.py`，此时直接选 WebSocket 即可，无需手动启动。

#### 方式 B：Web Serial 直连（更简单)

1. 点击 **Connect** → 选 **Serial (USB/UART)** → 波特率 115200
2. 点击 **连接** → 浏览器弹端口选择框
3. 选择 `/dev/ttyACM0`

---

## 6. 功能使用详解

### 6.1 Fly 视图（默认主界面）

顶部工具栏：左 = 品牌区；中 = Fly/Plan/Analyze/Setup/Params 视图切换；右 = Link/Battery/GPS/RC/Mode/Armed 指示器 + Connect 按钮。

- **人工地平仪**：蓝=天空、棕=大地，横线=pitch，竖线=roll，中央十字=机头方向
- **罗盘**：红针=机头朝向，外圈=偏航角（北 0°、东 90°）
- **读数列**：ALT 高度、REL 相对高度、GSPD 地速、ASPD 空速、ARM 解锁状态
- **底部遥测栏**：Altitude / Ground Speed / Air Speed / VSPEED / Distance / Battery / GPS / RSSI

### 6.2 地图

- **高德真实瓦片**（卫星图 + 街道标注叠加），自动 GCJ-02 纠偏
- 右上角按钮：`+` 放大、`-` 缩小、`◎` 居中飞行器
- 黄色十字 = 飞控位置，红色三角 = HOME，绿色折线 = 轨迹
- 右下角显示 HOME 经纬度、距 HOME 距离、航向、模式
- 地图瓦片已做**持久化缓存**（Service Worker），二次打开秒加载、可离线

### 6.3 Params 视图（参数编辑器 + 控制器切换）

点击顶部 **Params** 按钮进入：

- **控制器切换条**（顶部）：PID / LQR(INDI) / MPC 三个按钮，点击即写飞控参数（见 §7）
- **参数树**：按类别/分组两级树形展示全部参数
- **搜索**：按参数名过滤
- **编辑**：点击参数 → 编辑对话框（整数/浮点类型校验 + 范围校验）
- **Tools 菜单**：Refresh（刷新）/ Reset all（重置默认）/ Load（从文件加载）/ Save（保存到文件）/ Reboot（重启飞控）
- 枚举参数（如 IFSC_DIST_SW）渲染为下拉选择

### 6.4 Analyze 视图（日志下载）

1. 切换到 **Analyze** → 点击 **Logs**
2. 点击"刷新列表" → 通过 MAVLink FTP 请求 `/fs/microsd/log` 目录
3. 展开 session 目录（sess100、sess101…）→ 点击 `.ulg` 文件下载

> 100 MB 日志约需 30 秒（取决于 USB 速度），下载后用桌面版 QGC 打开分析。

### 6.5 Setup 视图（传感器 / 遥控器校准）

**需先连接飞控**，按钮才可用：

- **传感器校准**：罗盘 / 陀螺仪 / 加速度计 / 水平 / 空速
  - 点击对应按钮 → 按 6 方位图（底部朝下/顶部朝下/机头朝下/机尾朝下/左侧朝下/右侧朝下）摆放机体 → 观察进度条
- **遥控器校准**：点击"遥控器 Radio"→ 来回拨动摇杆到极限 → 观察 8 条通道实时数值
- **Actions**：重置传感器校准（`MAV_CMD_PREFLIGHT_STORAGE param1=3`）、重启飞控

### 6.6 Plan 视图（航点规划）

列出航点列表 + 右侧规划摘要。支持添加/删除航点、设置默认高度/速度。**注意：航点上传至飞控尚未实现**（需 MISSION_PROTOCOL）。

### 6.7 MAVLink 消息面板

点击顶部 **MSG** 指示器 → 弹出面板显示：

- 每种 MAVLink 消息的接收计数
- 最近 50 条系统消息（含严重级别）
- 实时消息速率（Hz）与最近一条消息距今时间

---

## 7. 控制器切换功能（IFSC_DIST_SW）

**这是 IFSC-Station 的核心定制功能**，用于在飞行中切换控制律。

### 7.1 三个控制器

| 值 | 名称 | 说明 |
|---|---|---|
| 0 | **PID** | 飞控内置 PID 控制律 |
| 1 | **LQR (INDI)** | LQR 控制器（增量非线性动态逆 INDI） |
| 2 | **MPC** | 模型预测控制 |

### 7.2 使用方法

1. 连接飞控（§4 或 §5）
2. 进入 **Params** 视图
3. 点击顶部 **控制器切换条** 的 PID / LQR(INDI) / MPC 按钮
4. 网页通过 `PARAM_SET` 写入 `IFSC_DIST_SW`，飞控端 `param_control` 模块检测到参数变化后切换控制律

### 7.3 前提条件

- **飞控固件必须内置 `param_control` 模块与 `IFSC_DIST_SW` 参数**（新固件 `px4_fmu-v6c_default(4).px4` 已含）。
- 若连接后 Params 视图看不到 `IFSC_DIST_SW`，说明固件未含该参数（需重新烧写新固件）。

---

## 8. 常见问题

### 8.1 无法连接（选串口后 5 秒仍 "0 Hz · 无数据"）

1. 关闭 QGroundControl（串口只能被一个进程占用）
2. Ubuntu 检查 dialout 权限：`groups | grep dialout`
3. F12 Console 查看是否打印 `[GCS HB#1] 发送 HEARTBEAT` 与 `[VEH HB#1]`
4. 确认波特率 115200
5. 确认是数据线（非纯充电线）

### 8.2 端口选择框显示 "No devices available"

1. 重新插拔 USB
2. Ubuntu：`ls /dev/ttyACM*`；Windows：设备管理器看 "USB Serial Device (COMx)"
3. Chrome 地址栏 `chrome://device-log` 看权限历史

### 8.3 Web Serial 报 "device has been lost"（Pixhawk USB 口）

这是 Pixhawk 6C USB CDC 口对 Web Serial 直连的已知问题。**改用 WebSocket 桥接**（§5.2 方式 A）。

### 8.4 地图空白 / 瓦片加载慢

首次打开需下载瓦片（网络延迟 + 高德子域名）。已内置两重优化：

- 启动健康探测：自动剔除不可达的子域名
- Service Worker 持久缓存：首次下载后永久缓存，二次打开秒加载

如首次仍慢，属正常网络延迟，等瓦片加载完即可；后续打开会明显变快。

### 8.5 看不到 IFSC_DIST_SW 参数

固件未含 `param_control` 模块。需烧写新固件 `px4_fmu-v6c_default(4).px4`。

### 8.6 刷新页面后状态丢失

正常：网页版不持久化连接状态，刷新 = 重新连接。

### 8.7 日志下载卡住

1. F12 Console 看 `[FTP]` 日志，确认 `ReadFile iter=XXX offset=YYY`
2. 停超过 30 秒 → 重试一次；反复卡住 → 检查 USB 接触

---

## 9. 性能与限制

### 9.1 性能指标

| 指标 | 实测值 |
|---|---|
| 连接建立 | < 2 秒 |
| ATTITUDE 更新率 | 20 Hz |
| 仪表盘帧率 | 60 FPS |
| CPU / 内存 | < 5% / ~150 MB |

### 9.2 当前限制

| 限制 | 说明 |
|---|---|
| 单连接 | 一个浏览器标签页 = 一个飞控连接 |
| 无视频流 | 需 GStreamer，Web 端未实现 |
| 无航点上传 | MISSION_PROTOCOL 未实现 |
| 无固件升级 | 网页版未实现（用桌面版） |
| 无加密 | HTTP 明文，勿暴露公网 |

### 9.3 安全提示

- ❌ 不要把 HTTP 服务器暴露到公网
- ✅ 仅在可信本地网络使用
- ✅ Web Serial 需 localhost 或 HTTPS；服务器 `http://IP` 访问时 Web Serial 不可用（仅能看页面功能）

---

## 附录 A：启动与连接速查

```bash
# === Ubuntu ===
sudo usermod -aG dialout $USER   # 一次性，然后重新登录
pip3 install pyserial            # 桥接模式需要
cd ~/IFSC-web
./start.sh                       # 启动网页（自动开浏览器）

# 连接：WebSocket 桥接（推荐）——start.sh 会自动拉起桥接
# 网页 Connect → WebSocket Bridge → ws://localhost:8766

# 或 Web Serial 直连
# 网页 Connect → Serial → 115200 → 选 /dev/ttyACM0
```

```bat
REM === Windows ===
REM 1. 装 Python（勾 Add to PATH）
REM 2. 关 QGroundControl，插飞控 USB
REM 3. 双击 start.bat → 浏览器自动打开
REM 连接：网页 Connect → Serial → 115200 → 选 USB Serial Device (COMx)
```

## 附录 B：相关文档

- [开发手册](IFSC_Station_网页版开发手册.md) — 实现原理、问题排查
- [桌面版安装与运行手册](IFSC_Station_安装与运行手册.md) — AppImage 版
- [定制与打包手册](IFSC_Station_定制与打包手册.md) — 二次开发与品牌化
- [测试手册](IFSC_Station_测试手册.md) — 冒烟测试

---

**文档版本**：V2.0（2026-08-07，重写：目录名改为 IFSC-web、新增真实地图/参数编辑器/控制器切换/传感器校准、双连接方式、Windows+Ubuntu 分节）
**网页版版本**：IFSC-Web V1.1
**作者**：IFSC Station 项目组
