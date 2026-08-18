# IFSC-Station 网页版开发手册

> 适用版本：**IFSC-Station Web V1.0**（基于 QGC 4.2.8 源码的纯 Web 复刻）。
> 适用读者：参与该网页端开发、定制、二次集成的工程师。
> 配套文档：[使用手册](IFSC_Station_网页版使用手册.md) / [AppImage 安装与运行手册](IFSC_Station_安装与运行手册.md) / [定制与打包手册](IFSC_Station_定制与打包手册.md) / [测试手册](IFSC_Station_测试手册.md)。

本文档完整记录 **网页版 IFSC-Station（`qgc-web`）** 的研发过程：

- 项目为何要做、做到什么程度
- 整体技术栈与目录结构
- 每一个核心功能是如何实现的（不是 API 列表，是"为什么这样写、对应 QGC 哪一段源码"）
- 中途遇到的关键问题、根因、解决方案
- 后续可继续扩展的方向

---

## 0. 目录

1. [项目背景与目标](#1-项目背景与目标)
2. [技术栈与运行原理](#2-技术栈与运行原理)
3. [代码目录结构](#3-代码目录结构)
4. [核心功能实现](#4-核心功能实现)
   - 4.1 [MAVLink 协议解析（mavlink.js）](#41-mavlink-协议解析mavlinkjs)
   - 4.2 [Web Serial 通信（telemetry.js）](#42-web-serial-通信telemetryjs)
     - 4.2.1 [连接流程](#421-连接流程)
     - 4.2.2 [写入串行化](#422-写入串行化)
     - 4.2.3 [GCS HEARTBEAT 心跳](#423-gcs-heartbeat-心跳)
     - 4.2.4 [消息流订阅](#424-消息流订阅)
     - 4.2.5 [状态对象](#425-状态对象)
     - 4.2.6 [飞控位置信息读取（GLOBAL_POSITION_INT / HOME_POSITION / ALTITUDE）](#426-飞控位置信息读取global_position_int--home_position--altitude)
     - 4.2.7 [定位测试辅助（GPS fix 状态与 __debug）](#427-定位测试辅助gps-fix-状态与-debug)
     - 4.2.8 [飞控速度信息读取（VFR_HUD）](#428-飞控速度信息读取vfr_hud)
   - 4.3 [WebSocket 桥接（ws_bridge.py）](#43-websocket-桥接ws_bridgepy)
   - 4.4 [主界面与工具栏（app.js + index.html）](#44-主界面与工具栏appjs--indexhtml)
   - 4.5 [仪表盘（attitude.js / compass.js）](#45-仪表盘attitudejs--compassjs)
   - 4.6 [地图（map.js / flyview.js）](#46-地图mapjs--flyviewjs)
   - 4.7 [日志下载 FTP 协议（telemetry.js + views/logs.js）](#47-日志下载-ftp-协议telemetryjs--viewslogsjs)
   - 4.8 [品牌化（IFSC 蓝、Logo、Favicon）](#48-品牌化ifsc-蓝logofavicon)
   - 4.9 [一键启动脚本（start.py）](#49-一键启动脚本startpy)
   - 4.10 [Windows 一键启动脚本（start.bat）与服务器部署打包](#410-windows-一键启动脚本startbat与服务器部署打包)
5. [关键问题与解决方案](#5-关键问题与解决方案)
   - 5.20 [地图上无飞控图标 / 点击居中无反应](#520-地图上无飞控图标--点击居中无反应)
   - 5.21 [网页版无法读取飞控速度信息](#521-网页版无法读取飞控速度信息)
   - 5.22 [PX4 v1.17 升级后通信全面冻结](#522-px4-v117-升级后通信全面冻结)
   - 5.23 [Web Serial 打开即报 "device has been lost"](#523-web-serial-打开即报-device-has-been-lost)
   - 5.24 [WebSocket 连接失败（ws://localhost:8766 refused）](#524-websocket-连接失败wslocalhost8766-refused)
   - 5.25 [地图瓦片加载慢（子域名不可达 + TLS 握手延迟）](#525-地图瓦片加载慢子域名不可达--tls-握手延迟)
   - 5.26 [地图瓦片持久化缓存（Cache API / Service Worker）](#526-地图瓦片持久化缓存cache-api--service-worker)
   - 5.27 [IFSC-Station 控制器切换功能（IFSC_DIST_SW / param_control）](#527-ifsc-station-控制器切换功能ifsc_dist_sw--param_control)
6. [响应式与可访问性设计](#6-响应式与可访问性设计)
7. [调试方法](#7-调试方法)
8. [未来扩展方向](#8-未来扩展方向)

---

## 1. 项目背景与目标

### 1.1 为什么要做网页版

桌面版 IFSC-Station（AppImage）虽然功能完整，但有以下痛点：

| 痛点 | 网页版带来的解决 |
|---|---|
| 装机复杂：要装 libfuse2 / Qt5 / GStreamer / dialout | 纯静态文件 + Chrome，没有安装步骤 |
| 跨平台差：Ubuntu 22.04 与 24.04 依赖略有差异 | Chrome 一致行为（Web Serial 是 Chrome-only API） |
| 不能远程共享：操作员必须到工控机前 | 任意机器浏览器打开 `localhost:8000` 即可 |
| 不能嵌入：不能嵌进 Web 仪表盘/教学/演示系统 | iframe 即可嵌入 |
| 不能脚本化：所有交互只能人手动点 | 状态对象 `window.__qgc_lastTelemetry` 可被外部 JS 直接订阅 |

### 1.2 目标

**功能对齐桌面 QGC 的 80% 高频操作**：

| 功能 | 网页版 | 桌面 QGC |
|---|---|---|
| 串口连接飞控 | ✅ Web Serial | ✅ |
| 实时姿态/罗盘仪表 | ✅ Canvas | ✅ QML |
| 地图 + 缩放/居中 | ✅ SVG | ✅ QtLocation |
| 顶部罗盘条 + 仪表读数 | ✅ | ✅ |
| 日志目录浏览 + 下载 | ✅ MAVLink FTP | ✅ |
| 多视图切换（Fly/Plan/Analyze/Setup） | ✅（4 视图壳） | ✅ |
| Mission 规划 | ⚠️ 仅有 UI 框架 | ✅ 完整 |
| 视频流 | ❌ | ✅ GStreamer |
| 固件升级、参数编辑器 | ❌ | ✅ |

**目标用户**：实验室调试、教学演示、远程遥测观察、嵌入第三方系统。

### 1.3 不做什么

- 不做视频流（GStreamer WebCodec API 还在实验）
- 不做参数编辑器（参数数量爆炸，UI 工作量大）
- 不做固件升级（PX4 Bootloader 协议在 Web Serial 上下文里复杂）
- 不做飞行规划编辑（MissionItemIndicator / drag 交互成本过高）

---

## 2. 技术栈与运行原理

### 2.1 核心技术

| 层 | 技术 | 为什么选它 |
|---|---|---|
| 串口 | **Web Serial API** | Chrome 直接访问 `/dev/ttyACM0`，无需 NPAPI 插件 |
| 二进制协议 | **纯 JS 手写 MAVLink v1/v2 解析器** | 体积小（559 行），可读性高 |
| UI 框架 | **零框架，原生 ES Modules** | 不引 React/Vue，构建零依赖、启动快 |
| 仪表盘 | **HTML5 Canvas 2D** | 罗盘/地平仪需要逐帧重绘 |
| 地图 | **真实 XYZ 瓦片（高德，GCJ-02）** | 区域名/街道/卫星影像；本地瓦片渲染 + WGS-84→GCJ-02 纠偏 |
| 样式 | **手写 CSS（CSS variables）** | 与 QGC QGCPalette 一一对应 |
| 图标 | **直接复用 QGC 源码 SVG 资源** | 与桌面版像素一致 |
| 静态服务器 | **Python `http.server`** | 系统自带，零部署 |

### 2.2 运行原理

```
┌─────────────┐  Web Serial (Chrome)  ┌──────────┐
│  Pixhawk    │ ◄──────────────────►  │  Chrome  │
│  6C Mini    │   MAVLink v2 bytes    │  浏览器  │
└─────────────┘        ▲               └────┬─────┘
                       │ pyserial           │ WebSocket (可选)
                       ▼                    ▼
                ┌────────────────┐   ┌─────────────┐
                │  ws_bridge.py  │◄─►│  浏览器      │
                │  (串口常开桥)   │   └─────────────┘
                └────────────────┘
```

1. **首选路径**：浏览器调用 `navigator.serial.requestPort()` 弹端口选择框 → 用户选 `/dev/ttyACM0` → 浏览器以 115200 波特率打开串口 → 字节流通过 `WritableStream` 写入、`ReadableStream` 读出 → `mavlink.js` 解析 MAVLink 帧 → `telemetry.js` 更新 state → widgets 通过 `requestAnimationFrame` 轮询 `window.__qgc_lastTelemetry` 重绘。
2. **备选路径**（串口被占用 / 非 Chrome / 飞控 USB 口对 Web Serial 打开方式敏感）：运行 `ws_bridge.py`（Python 标准库 + pyserial 的 WebSocket 桥，见 4.3），网页端通过 `ws://localhost:8766` 双向转发 MAVLink 字节流。此桥用 pyserial 打开串口并**常开不关**，稳定性和桌面端 QGC 一致。

### 2.3 关键约束（踩过的坑）

- **Web Serial 必须 `localhost` 或 `https://`**，不能是 IP。文档化在 [使用手册](IFSC_Station_网页版使用手册.md)。
- **MAVLink CRC 算法是 CRC-16/MCRF4XX**（poly 0x8408 reflected），**不是** CRC-16/MODBUS（poly 0xA001）。用错会导致飞控静默丢帧。
- **PX4 MAVLink FTP 自动在路径前拼 `_root_dir="/fs/microsd"`**，客户端必须发相对路径（`""` 表示根、`"log"`），发绝对路径 `/fs/microsd/log` 会 FileNotFound。
- **Web Serial WritableStream 是独占的**，必须用 `getWriter()` / `releaseLock()` 配对，并在并发写入时串行化（Promise queue）。
- **PX4 静默丢 CRC 错的帧**，不会回 NAK，调试时只能看到 `0xFE=0 0xFD=0` 这种"收不到回应"的迹象。

---

## 3. 代码目录结构

```
qgc-web/
├── index.html                  # 单页入口 (仿 QGC MainRootWindow.qml)
├── src/
│   ├── app.js                  # 应用入口: 视图切换 / ToolStrip / Popup
│   ├── mavlink.js              # MAVLink v1/v2 帧解析 + 编码
│   ├── telemetry.js            # 串口/WebSocket 收发 + state 状态机
│   ├── styles.css              # QGCPalette 映射 + 响应式
│   ├── views/
│   │   ├── flyview.js          # Fly 视图 (地图+仪表+遥测栏)
│   │   ├── planview.js         # Plan 视图 (航点编辑框架)
│   │   ├── logs.js             # Analyze 视图 (MAVLink FTP 拉取日志)
│   │   └── setupview.js        # Setup 视图
│   └── widgets/
│       ├── attitude.js         # Canvas 人工地平仪
│       ├── compass.js          # Canvas 罗盘
│       ├── map.js              # 瓦片地图 (高德 XYZ + GCJ-02 纠偏 + 缩放/居中/轨迹)
│       ├── scale.js            # 比例尺
│       └── chart.js            # 时序图
├── qrc/                        # QGC 资源 (原样复用)
│   └── resources/
│       ├── icons/IFSC_logo.png
│       ├── toolbar/*.svg
│       ├── FlightMap/          # 从 QGC src/FlightMap/Images 复制
│       │   ├── ZoomPlus.svg
│       │   ├── ZoomMinus.svg
│       │   ├── MapCenter.svg
│       │   └── MapCenterBlack.svg
│       └── fonts/OpenSans-*.ttf
├── ws_bridge.py                 # Web Serial 备选: 串口→WebSocket 桥 (pyserial 常开 + RFC6455 服务端)
└── qgc_test_runner.py          # 串口原始数据 dump 工具
```

代码量统计（V1.0）：

| 文件 | 行数 | 说明 |
|---|---|---|
| `src/app.js` | 572 | 主入口 |
| `src/mavlink.js` | 559 | MAVLink 协议 |
| `src/telemetry.js` | 767 | 通信 + FTP |
| `src/styles.css` | 1070 | 样式 |
| `src/views/*.js` | 655 | 4 个视图 |
| `src/widgets/*.js` | 761 | 5 个 widget |
| `index.html` | 127 | 入口 |
| **合计** | **4511** | |

---

## 4. 核心功能实现

### 4.1 MAVLink 协议解析（mavlink.js）

#### 4.1.1 帧结构

MAVLink v1 帧（8 字节头 + 1..255 字节 payload + 2 字节 CRC）：

```
0      1          2        3      4     5    6     7      8..N         N+1 N+2
STX    len        seq      sysid  compid msgid ... payload ...     CRC_lo CRC_hi
0xFE   payload_len
```

MAVLink v2 帧（10 字节头 + payload + CRC + optional signature）：

```
0      1          2        3      4     5    6    7    8     9      10..N
STX    len        incompat seq   sysid compid msgid(24-bit)    payload ...
0xFD   payload_len flags
```

#### 4.1.2 解析器实现要点（[mavlink.js](file:///home/lu/qgc-web/src/mavlink.js)）

1. **流式状态机**：`state` 枚举 `WANT_STX / WANT_LEN / WANT_SEQ / ... / WANT_PAYLOAD / WANT_CRC1 / WANT_CRC2 / WANT_SIGNATURE`，每读一字节推进一状态。
2. **重同步策略**：CRC 失败或长度超界时回到 `WANT_STX`，扫描下一字节看是否是 0xFE/0xFD。
3. **CRC-16/MCRF4XX**：必须用 poly 0x8408（reflected），代码里有完整 `crc_accumulate()` 与 256 项表生成：

   ```js
   // 正确: CRC-16/MCRF4XX
   for (let i = 0; i < 256; i++) {
     let crc = i;
     for (let j = 0; j < 8; j++) {
       crc = (crc & 1) ? ((crc >>> 1) ^ 0x8408) : (crc >>> 1);
     }
     CRC_TABLE[i] = crc;
   }
   ```

4. **MAVLink v2 `msgid` 是 24-bit**（不是 16-bit），需 `msgid = b[7] | (b[8]<<8) | (b[9]<<16)`。
5. **SIGNED 帧**：incompat flags bit 0 = 1 时，CRC 后追加 13 字节签名（LinkIdentity）。V1.0 不实现签名验证，跳过 13 字节即可。
6. **`crcExtra`**：每个消息的尾部额外 CRC 字节，必须与 payload 一起参与 CRC 计算。V1.0 内置 13 个常用消息（HEARTBEAT / ATTITUDE / GPS_RAW_INT / ...）的 `crcExtra`，其它消息在 `MAVLINK_MSG_CRC_EXTRA` 表中查。

#### 4.1.3 编码器

`encodeFrame(msgid, payload, sysid, compid, seq, targetSys, targetComp)` 构造 v1 帧返回 Uint8Array。v2 编码同样支持。`FILE_TRANSFER_PROTOCOL`（FTP）有专门 `encodeFTPPayload()` 构造 251 字节 payload（12 字节 FTP header + 239 字节数据），原因见 4.7。

#### 4.1.4 解析器测试

打开 `console` 应看到：

```
[MAV] RX frame: msgid=0(HEARTBEAT) len=9 sysid=1 compid=1
[STATE] HEARTBEAT type=2 autopilot=3 base_mode=4 system_status=3
```

若 `RX frame` 长期为 0 但串口收到字节，多半是 CRC 算法错了（飞控静默丢）。

---

### 4.2 Web Serial 通信（telemetry.js）

#### 4.2.1 连接流程

```js
async function connectSerial() {
  const port = await navigator.serial.requestPort();  // 弹端口选择
  await port.open({ baudRate: 115200 });
  // reader loop
  const reader = port.readable.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parseBytes(value);   // 喂给 mavlink 解析器
  }
  reader.releaseLock();
}
```

**关键约束**：必须 115200 波特率（Pixhawk 6C Mini 默认）。若用 921600 也能跑但需要飞控端同样配置。

#### 4.2.2 写入串行化

`WritableStream.getWriter()` 是独占的，多个并发 `write()` 会抛 `ERR_INVALID_STATE`。解决：

```js
let writeQueue = Promise.resolve();
function serialWrite(bytes) {
  writeQueue = writeQueue.then(async () => {
    const w = port.writable.getWriter();
    await w.write(bytes);
    w.releaseLock();
  });
  return writeQueue;
}
```

所有 `mavlink.encodeFrame(...)` 后都走 `serialWrite()`，顺序得到保证。

#### 4.2.3 GCS HEARTBEAT 心跳

每 1 秒发一个 HEARTBEAT：

```js
{
  type: 6,            // MAV_TYPE_GCS
  autopilot: 8,        // MAV_AUTOPILOT_INVALID
  base_mode: 4,        // MAV_MODE_MANUAL_ARMED
  custom_mode: 0,
  system_status: 4     // MAV_STATE_ACTIVE
}
```

`base_mode=4` 是关键：飞控靠这个判断 GCS "在线"，从而向 GCS 流式推送消息。如果用 `base_mode=0` 飞控会进入"安全模式"停止数据流。

#### 4.2.4 消息流订阅

收到飞控 HEARTBEAT 后，主动发 `MAV_CMD_SET_MESSAGE_INTERVAL`（cmd 511）请求关键消息流：

| 消息 ID | 名称 | 请求间隔 | 用途 |
|---|---|---|---|
| 0 | HEARTBEAT | 1 Hz | 心跳 |
| 30 | ATTITUDE | 50 Hz | 姿态仪/罗盘 |
| 33 | GLOBAL_POSITION_INT | 10 Hz | 经纬度高度/速度 |
| 24 | GPS_RAW_INT | 5 Hz | GPS 状态 |
| 1 | SYS_STATUS | 1 Hz | 电池/传感器 |
| 74 | VFR_HUD | 4 Hz | 空速/地速/爬升率（见 4.2.8） |
| 27 | RAW_IMU | 10 Hz | IMU 原始数据 |
| 29 | SCALED_IMU2 | 10 Hz | 加速度/角速度 |
| 31 | ATTITUDE_QUATERNION | 4 Hz | 四元数姿态 |
| 253 | STATUSTEXT | 0（on change） | 错误/警告文本 |

```js
// cmd 511 = MAV_CMD_SET_MESSAGE_INTERVAL
// param1 = msg id, param2 = interval (us), param7 = target sysid
sendCommandLong(511, msgid, intervalUs, 0, 0, 0, 0, 0, targetSys);
```

> **踩坑**：早期版本把 `[105, 1, 'VFR_HUD']` 写进请求列表——`105` 其实是 `HIGRES_IMU`，`VFR_HUD` 是 `74`。结果 VFR_HUD 从未被请求、飞控从不推送，空速/爬升率永远为 0。详见 5.21。

#### 4.2.5 状态对象

`state = { attitude, position, velocity, battery, gps, rc, armed, mode, home, ... }` 通过 `setState({ ...state, ...patch })` 更新，所有 widgets 用 `requestAnimationFrame` 轮询 `window.__qgc_lastTelemetry`。这个全局对象是**有意暴露**的，方便第三方页面/iframe 嵌入时直接读取。

#### 4.2.6 飞控位置信息读取（GLOBAL_POSITION_INT / HOME_POSITION / ALTITUDE）

对应 QGC `Vehicle::_handleGlobalPositionInt` / `_handleHomePosition` / `_handleAltitude` 三条消息处理链路，在 `telemetry.js` 的 `handleMessage` 中实现。这是本网页版**获取飞控经纬度/高度/航迹的核心路径**。

**（1）GLOBAL_POSITION_INT（msgid 33）— 主位置源**

```js
// 对应 QGC Vehicle.cc _handleGlobalPositionInt()
if (msg.lat === 0 && msg.lon === 0) {
  // ArduPilot 无 GPS 时仍发 (0,0) 坐标仅携带高度 → 必须过滤
  if (!state._altAvailable) {
    pushMessage(5, 'GPS 未锁定 (收到 0,0 坐标), 等待 GPS fix...');
    state._altAvailable = true;
  }
  state.position.alt = msg.alt / 1000;          // 仅更新高度
  state.position.relative_alt = msg.relative_alt / 1000;
  emit();
  return;
}
```

- **单位换算**：`lat/lon` 为 1E7 度整数 → 除以 1E7；`alt` 为 mm → 除以 1000。与 QGC 一致。
- **（0,0）过滤**：ArduPilot 在无 GPS 锁定时仍发送 GLOBAL_POSITION_INT（用于携带高度），坐标是无效的 (0,0)。若不过滤，地图会把飞行器图标画到赤道附近。QGC 同样做了这个判断。
- **home 回退**：若未收到飞控的 HOME_POSITION 消息（`_homeSet=false`），用首次有效 GPS 坐标作为 home（QGC `_possiblyCenterToVehiclePosition` 语义）。

**（2）HOME_POSITION（msgid 242）— home 点权威来源**

```js
// 对应 QGC Vehicle.cc _handleHomePosition()
const home = { lat: msg.latitude / 1e7, lon: msg.longitude / 1e7, alt: msg.altitude / 1000 };
if (home.lat !== state.home.lat || home.lon !== state.home.lon) {
  state.home = home;
  state._homeSet = true;   // 标记"飞控已明确上报 home", 阻止首次 GPS 覆盖
}
```

飞控（PX4 上电时）会发送 HOME_POSITION 消息明确上报起飞点。此消息**优先级高于**首次 GPS 坐标回退，保证 home 标记位置正确。消息定义加入 `mavlink.js`：

```js
HOME_POSITION: { id: 242, name: 'HOME_POSITION', crcExtra: 104, fields: [ ... ] }
```

**（3）ALTITUDE（msgid 141）— 独立高度消息**

PX4 额外发送 ALTITUDE 消息（amsl/relative/terrain 等 7 个高度值）。作为 GLOBAL_POSITION_INT 之外的后备高度源：

```js
// 对应 QGC Vehicle.cc _handleAltitude()
state.position.alt = msg.altitude_amsl;
state.position.relative_alt = msg.altitude_relative;
state._altTerrain = msg.altitude_terrain;   // 地面高度
state._altLocal  = msg.altitude_local;      // 局部坐标系高度
```

**（4）内部状态标志**（对齐 QGC Vehicle 私有变量）：

| 标志 | 含义 | 对应 QGC |
|---|---|---|
| `_gpsPosAvailable` | 收到过有效 GLOBAL_POSITION_INT | `_globalPositionIntMessageAvailable` |
| `_homeSet` | 收到飞控 HOME_POSITION | `homePositionChanged` 已触发 |
| `_altAvailable` | 收到过高度数据 | `_altitudeMessageAvailable` |

这三个标志贯穿位置、home、高度三套数据源，避免互相覆盖、保证"第一次有效数据"语义正确。

#### 4.2.7 定位测试辅助（GPS fix 状态与 __debug）

**（1）界面 GPS fix 指示**

`flyview.js` 状态面板新增 GPS 行与 LAT/LON 的 "No GPS" 提示：

- `fix_type >= 3`（3D/DGPS/RTK）→ 绿色 `3D · N sats`，此时才信任坐标
- `fix_type == 2`（2D）→ 橙色 `2D · N sats`
- 无 fix → 红色 `No Fix`，LAT 显示 `No GPS`

只有 GPS 达到 3D 后地图才会出现飞行器图标、航迹与 HOME 标记，这是判断"定位是否生效"的直观依据。

**（2）浏览器控制台诊断 `window.__debug()`**

连接飞控后按 F12 → Console：

```js
window.__debug()
// → { connected, link, armed, mode, gps: {fix_type, sats, hdop},
//     position, home, pathLength, _gpsPosAvailable, _homeSet,
//     msgRate, lastMsgAge }
```

重点看 `gps.fix_type`（≥3 才有效）、`_gpsPosAvailable`（收到过有效坐标）、`pathLength`（航迹点数 >0 说明飞行器图标会渲染）。

#### 4.2.8 飞控速度信息读取（VFR_HUD）

对应 QGC `Vehicle::_handleVfrHud`（`src/Vehicle/Vehicle.cc` L986）。VFR_HUD（msgid 74）是**空速 / 地速 / 爬升率 / 航向 / 油门的权威来源**，桌面 QGC 的三个速度 Fact（`airSpeed` / `groundSpeed` / `climbRate`）全部来自这条消息，不是来自 GLOBAL_POSITION_INT。

**（1）消息定义（mavlink.js）**

```js
VFR_HUD: { id: 74, name: 'VFR_HUD', crcExtra: 20, fields: [
  { n: 'airspeed',    t: 'f' }, { n: 'groundspeed', t: 'f' },
  { n: 'alt',         t: 'f' }, { n: 'climb',       t: 'f' },
  { n: 'heading',     t: 'h' }, { n: 'throttle',    t: 'H' },
]},
```

- 线上布局共 20 字节，`crcExtra = 20`（可在 `qgroundcontrol/libs/mavlink/.../common/common.h` 的 `MAVLINK_MESSAGE_CRCS` 表中查到 `{74, 20, 20, 20}`）。
- **字段顺序陷阱**：XML 声明顺序是 `airspeed, groundspeed, heading, throttle, alt, climb`，但 mavgen 会把字段按 4 字节对齐重排为 `airspeed@0, groundspeed@4, alt@8, climb@12, heading@16, throttle@18` —— **alt 在 climb 之前**。第一版把两者写反，靠 pymavlink 真值解码对比抓出（见 5.21）。

**（2）消息流订阅（telemetry.js）**

`STREAM_REQUESTS` 中必须用正确 msgid 请求：`[74, 4, 'VFR_HUD']`（4 Hz）。早期版本误写 `[105, 1, 'VFR_HUD']`（105 是 HIGRES_IMU），导致 VFR_HUD 从未被请求。

**（3）状态更新（telemetry.js `handleMessage`）**

```js
} else if (msg._name === 'VFR_HUD') {
  // 对齐 QGC Vehicle::_handleVfrHud
  const v = state.velocity;
  if (typeof msg.airspeed === 'number' && isFinite(msg.airspeed)) v.airspeed = msg.airspeed;
  if (typeof msg.groundspeed === 'number' && isFinite(msg.groundspeed)) v.groundspeed = msg.groundspeed;
  if (typeof msg.climb === 'number' && isFinite(msg.climb)) v.climb = msg.climb;
  v.heading = msg.heading || 0;
  v.throttle = msg.throttle || 0;
}
```

**（4）地速/空速/垂直速度的来源分工**

| 速度 | 权威来源 | 兜底逻辑 |
|---|---|---|
| GroundSpeed | VFR_HUD.groundspeed | GLOBAL_POSITION_INT vx/vy 的 hypot |
| AirSpeed | VFR_HUD.airspeed | 无空速管（多旋翼）时回退显示地速（与 QGC 一致） |
| VSPEED | VFR_HUD.climb（向上为正） | 未收到时用 `-vz`（GLOBAL_POSITION_INT vz 为 cm/s、NED 正=向下，需取负） |

GLOBAL_POSITION_INT 分支中**不再用 `hypot(vx,vy)` 覆盖 airspeed**，只在地速为空速兜底时使用。`state.velocity` 扩展为 `{ vx, vy, vz, groundspeed, airspeed, climb, heading, throttle }`。

**（5）UI 显示（flyview.js）**

- 仪表读数：`irGSpdV` / `irASpdV`（GSPD / ASPD 行）
- 底部遥测栏：`tbGSpd` / `tbASpd` / `tbVSpd`（GSPD / ASPD / VSPEED cell）

---

### 4.3 WebSocket 桥接（ws_bridge.py）

Web Serial 不可用时（Firefox / 旧版 Chrome / 飞控 USB 口对 Web Serial 打开方式敏感导致 device-lost，见 5.23）的备选。纯 Python **标准库 + pyserial** 实现，零额外依赖（不依赖 `websockets` 包），单文件可直接运行。

```bash
python3 ws_bridge.py                     # 默认 /dev/ttyACM0 @115200, WS 端口 8766
python3 ws_bridge.py --baud 921600       # 自定义波特率
python3 ws_bridge.py --ws 9000           # 自定义 WS 端口
```

网页端 Connect 弹窗 → 选 **WebSocket Bridge** → URL 填 `ws://localhost:8766`。

**（1）为什么不是 websockets 库**

第一版打算用 `websockets` 包，但目标机器没装且不想引入 pip 依赖。最终用标准库 `socket` + `threading` + `hashlib`/`base64` 手写 RFC 6455 服务端最小实现，仅 240 行：

- **握手**：解析 HTTP Upgrade 请求，取 `Sec-WebSocket-Key`，拼 GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` 做 SHA-1 + base64，回 `101 Switching Protocols`。
- **帧解析**：读 2 字节帧头，`FIN/opcode/mask/length`；长度 126 读 2 字节扩展、127 读 8 字节扩展；**客户端帧必须 masked**，按 4 字节 mask key 逐字节异或还原。
- **帧发送**：服务端帧不掩码，`opcode 0x2`（binary）发 MAVLink 字节流、`0xA`（pong）回 ping。
- **协议细节**：`0x8` close 帧断开、`0x9` ping 回 `0xA` pong。

**（2）串口策略：常开不关**

pyserial 打开串口后**在整个程序生命周期内保持打开**，绝不反复 open/close——反复开关正是触发 Pixhawk USB 复位进 bootloader 的原因（见 5.23）。多个浏览器轮流连上/断开，串口始终只开一次。

**（3）双向透传**

```python
def rx_loop():                     # 串口 → WebSocket
    while not stop_evt.is_set():
        data = ser.read(4096)
        if data: ws_send(conn, data, 0x2)   # binary

# 主循环: WebSocket → 串口 (带写锁串行化)
opcode, payload = ws_read_frame(conn)
if opcode in (0x1, 0x2) and payload:
    with write_lock:
        ser.write(payload)
```

串口写用 `threading.Lock` 串行化（与浏览器端 WritableStream 串行化同理）。串口读阻塞 0.05s 超时轮询，保证 Ctrl+C 能及时退出。

**它只是透传**，不做任何 MAVLink 解析。所有 MAVLink 逻辑都在浏览器端，保证"Web Serial 路径"和"WebSocket 路径"行为完全一致。

**不实现"mock 演示"**——所有数据必须来自真实飞控。如果页面需要 demo 数据，应该另外做 `mock_data_server.py`，且不与生产代码混淆。可连接性已用 pty 伪终端做过端到端测试（握手 / 串口→WS / WS→串口 / 512B 大帧 / ping-pong / 断连后进程存活）。

---

### 4.4 主界面与工具栏（app.js + index.html）

#### 4.4.1 整体布局

仿 QGC `MainRootWindow.qml`：

```
┌──────────────────────────────────────────────────────┐
│ Toolbar (5.5vmin)                                    │  ← 深蓝品牌区 + 视图按钮 + 指示器 + Connect
├──────┬───────────────────────────────────────────────┤
│ Tool │                                               │
│ Strip│           View 内容                           │  ← 7vmin 左侧工具条
│      │                                               │
│      │                                               │
├──────┴───────────────────────────────────────────────┤
│ Telemetry Bar                                        │  ← 高度固定 (8 cells)
└──────────────────────────────────────────────────────┘
```

CSS Grid：

```css
.app {
  display: grid;
  grid-template-rows: 5.5vmin 1fr;
  height: 100vh;
}
.main {
  display: grid;
  grid-template-columns: auto 1fr;
}
```

#### 4.4.2 Toolbar 品牌区

左侧 28vmin 是深蓝 `#00427F` 渐变：

```css
.toolbar-brand {
  background: linear-gradient(90deg, #00427F 0%, #00427F 28vmin, var(--toolbar-bg) 38vmin);
}
```

右侧 12vmin 是从深蓝到黑色的渐变结束（`toolbar-brand::after`），让左侧品牌区与右侧 Toolbar 自然融合。

#### 4.4.3 视图切换

点击 `Fly/Plan/Analyze/Setup` → `switchView(name)` → 调用 `renderFlyView(root)` / `renderPlanView(root)` / ... 每个视图函数 `root.innerHTML = '...'` 替换 DOM → `requestAnimationFrame` 内初始化 widgets。

不存任何 React 式的"虚拟 DOM"——切换 = 重建 DOM。简单可靠，调试容易（DevTools 里看到的 DOM 就是真相）。

---

### 4.5 仪表盘（attitude.js / compass.js）

#### 4.5.1 人工地平仪

`createAttitude(container)` 在容器内创建 `<canvas>`，用 `ResizeObserver` 监听尺寸变化，初始化 canvas 像素：

```js
const dpr = window.devicePixelRatio || 1;
canvas.width = rect.width * dpr;
canvas.height = rect.height * dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

每帧 `tick()`：
1. 从 `window.__qgc_lastTelemetry.attitude` 读 `roll/pitch/yaw`
2. `ctx.save() → translate(center) → rotate(roll) → ... 画天空/大地 → restore()`
3. pitch 用 `translate(0, pitch * 100)` 模拟
4. 中央画十字线、飞机符号

#### 4.5.2 罗盘

同 attitude.js 结构。`lastYaw` 累积平滑（`lastYaw += angleDelta(lastYaw, d.yaw) * 0.2`），dial 旋转 `-lastYaw`（弧度）。`angleDelta` 处理 ±π 跳变避免 359°→1° 反向旋转。

**踩坑记录**：

最初写成 `ctx.rotate(-lastYaw * Math.PI / 180)`，因为 `lastYaw` 已经是弧度（来自 `angleDelta`），再乘 `PI/180` 等于再除 180，导致旋转量被压缩到几乎 0 → 罗盘不转。修复：直接 `ctx.rotate(-lastYaw)`。**这是最隐蔽的 bug**，因为单看代码两行都对。

#### 4.5.3 响应式

所有尺寸用 `vmin`（视口短边的 %）+ `min/max` 钳制：

```css
.compass-box {
  width: 22vmin;
  min-width: 160px;
  max-width: 280px;
  aspect-ratio: 1 / 1;
}
```

保证在 1366×768 到 4K 屏幕都正常。

---

### 4.6 地图（map.js / flyview.js）

#### 4.6.1 地图演进（3 代）

| 版本 | 方案 | 说明 |
|---|---|---|
| V1.0 | 手写 SVG"假地图" | 离线 SVG 网格 + 模拟色块 + 伪造地理背景，无真实地理信息；已被移除 |
| V2 | Esri XYZ 真实瓦片 | 参考 QGC `src/QtLocationPlugin/`，无 token 的 Esri ArcGIS 瓦片 |
| V3（当前） | 高德瓦片（GCJ-02） | 卫星底图 + 路网/注记标注层，WGS-84 → GCJ-02 坐标纠偏 |

#### 4.6.2 瓦片渲染（map.js）

参考 QGC 三处源码：

| 网页版实现 | QGC 源码 |
|---|---|
| 瓦片源（V2 用 Esri，V3 用高德 appmaptile） | `src/QtLocationPlugin/EsriMapProvider.cpp` |
| Web Mercator 投影（lon2px / lat2px / px2lon / px2lat） | `src/QtLocationPlugin/MapProvider.cpp` |
| 缩放步进 ±0.5、maxZoomLevel、keepMapCenteredOnVehicle、首次定位居中 | `src/FlightMap/FlightMap.qml` |
| 比例尺步长 `_scaleLengthsMeters`、km 显示规则 | `src/FlightMap/MapScale.qml` |

`renderTiles()` 瓦片渲染核心：

1. **分数缩放**：`zoomSplit()` 把小数 zoom 拆成整数级 `z0` + 屏幕放大系数 `s = 2^frac`（QGC 允许 zoom 为 0.5 步进的小数），瓦片 `width/height = 256 * s`。
2. **可见范围**：由中心点 GCJ-02 投影像素 ± 视口一半，除以 256 得瓦片行列范围 `(tx0..tx1, ty0..ty1)`。
3. **瓦片 DOM**：`<img class="map-tile">` 绝对定位，加载成功 `opacity: 0 → 1` 淡入，失败置 0（留空不报错）；不可见瓦片即时移除。
4. **经度环绕**：`wx = ((tx % 2^z0) + 2^z0) % 2^z0`，拖动跨过 180° 经线时继续显示对侧瓦片。
5. **防爆上限**：最多 128 张瓦片，防止极端缩放/视口下 DOM 爆炸。
6. **双层渲染（Hybrid）**：卫星底图 + 同 key 的透明标注瓦片（区域名/街道名），标注层 `pointer-events: none` 不挡拖拽。

`drawTelemetry()` 在 SVG 覆盖层上绘制：航迹（`#be781c`，QGC mapMissionTrajectory 配色）、HOME 标记、带机头朝向的飞行器图标；`renderScale()` 按 QGC MapScale 规则在左下角画比例尺（文字 + 双端刻度线）。

#### 4.6.3 交互（QGC 手势）

- **拖拽平移**：Pointer Events + `setPointerCapture`，拖动即 `keepMapCenteredOnVehicle = false`（QGC 语义）。
- **滚轮缩放**：`zoomAt()` 保持鼠标悬停点地理坐标不动，每次 ±0.5 级。
- **跟踪飞行器**：首次定位自动居中并缩放到 `FOLLOW_ZOOM`；持续跟踪时中心始终跟随，仅当位移 > 8px 才重载瓦片（避免高频重绘）。
- **按钮**：右上角 4 个 QGC 风格按钮（放大/缩小/居中/图层类型）。

#### 4.6.4 缩放按钮（仿 QGC `QGCMapToolButton.qml`）

完全复刻 QGC 源码模式：

| QGC QML | 网页版 |
|---|---|
| `Button { style: ButtonStyle { background: Rectangle { color: __qgcPal.window } } }` | `.map-widget-btn { background: rgba(0,0,0,.7); }` |
| `QGCColoredImage { source: imageSource; opacity: 0.6 (or 1.0 on hover) }` | `<img>` + `opacity: 0.6` (或 hover 时 `1.0`) |
| `anchors.fill: parent` | `width: 100%; height: 100%; object-fit: contain; padding: 18%` |
| `buttonImage: "/qmlimages/MapCenter.svg"` | `<img src="qrc/resources/FlightMap/MapCenter.svg" />` |
| `onClicked: map.zoomLevel += 0.5` | `btn.addEventListener('click', () => mapCtl.zoomIn())` |

**图标资源从 QGC 源码复制**（[qgroundcontrol/src/FlightMap/Images/](file:///home/lu/qgroundcontrol/src/FlightMap/Images)）到 `qrc/resources/FlightMap/`，保证像素级一致。图层类型按钮的 `Layers.svg` 取自 QGC `resources/InstrumentValueIcons/layers.svg`。

#### 4.6.5 高德坐标系（GCJ-02）

- 高德瓦片使用 **GCJ-02（火星坐标）**，MAVLink/GPS 数据是 **WGS-84**，两者存在 300–500m 非线性偏移，必须转换。
- 内联实现 `wgs84ToGcj02()`（标准 coordtransform 算法：`a=6378245.0`、`ee=0.00669342162296594323`，境外不偏移）+ `gcj02ToWgs84()`（差分迭代逆转换，一次迭代误差 < 1m）。
- **渲染链路**：`toScreen()` / `renderTiles()` / `gcjCenter()` 所有坐标先转 GCJ-02 再投影。
- **交互链路**：拖拽/缩放/zoomAt 在 GCJ-02 像素空间计算，存回 `view.center` 时逆转为 WGS-84，保证内部状态始终与 MAVLink 一致（遥测、坐标读数不漂移）。
- `MAX_ZOOM = 18`（高德瓦片最大级别）。
- 瓦片子域名轮换池 `['01','03','04']`，按 `(x+y)%3` 轮换（`02` 在当前网络环境连接不稳，见 5.11）。

#### 4.6.6 居中按钮

`mapCenter` 点击调用 `mapCtl.centerVehicle()`：重新开启跟踪并立即以当前飞行器位置为地图中心，`view.center` 始终存 WGS-84。

---

### 4.7 日志下载 FTP 协议（telemetry.js + views/logs.js）

#### 4.7.1 协议概述

PX4 实现 MAVLink FTP (FILE_TRANSFER_PROTOCOL msgid 110)：

```
GCS ─(ListDirectory/OpenFileRO/ReadFile/TermSession)→  PX4
PX4 ─(ACK + payload, 或 NAK + error)→                   GCS
```

#### 4.7.2 关键陷阱

| 坑 | 错的做法 | 对的做法 |
|---|---|---|
| 路径 | 发绝对路径 `/fs/microsd/log` | 发相对路径 `log`（PX4 自动拼 `_root_dir="/fs/microsd"`） |
| payload 长度 | 244 字节 | **必须 251 字节**（12 字节 header + 239 字节数据） |
| FTP header | 12 字节错位 | 严格按 [4] byte seq [2] byte session [1] opcode [1] req_opcode [4] size |
| `req_opcode` | 当成"上一次请求的 opcode" | **始终为 0**（MAVLink 规范） |
| 会话 ID | 假设非 0 | PX4 OpenFileRO 始终返回 `session=0`（单会话） |
| 列表解析 | 看到 NAK 再发 ReadFile | **ListDirectory ACK payload 直接含条目**（`D<name>\0` 或 `F<name>\t<size>\0`） |
| 文件结束 | 假设 length 对齐 | PX4 最后一段可能 < 200 字节，以 NAK(kErrEOF=6) 结束 |

#### 4.7.3 拉取流程（downloadFile）

```js
async function downloadFile(remotePath, onProgress) {
  // 1. OpenFileRO
  const { size: fileSize } = await ftpOpen(remotePath);
  // 2. 循环 ReadFile (每块 200 字节)
  let offset = 0;
  const chunks = [];
  while (offset < fileSize) {
    const chunk = await ftpRead(0, offset, 200);
    if (chunk.error === 6) break;  // EOF
    chunks.push(chunk.data);
    offset += chunk.data.length;
    onProgress(offset / fileSize);
  }
  // 3. TermSession
  await ftpTerminate(0);
  // 4. 拼 blob, 触发下载
  return new Blob(chunks);
}
```

#### 4.7.4 FTP 序列号

`ftpSeq` 与 `seq`（MAVLink 全局序列号）**独立**——FTP 用自己的计数器递增，否则 PX4 不会匹配响应。

---

### 4.8 品牌化（IFSC 蓝、Logo、Favicon）

#### 4.8.1 颜色变量

CSS 顶部定义 QGCPalette 映射：

```css
:root {
  --branding-ifsc:    #00427F;   /* IFSC 品牌深蓝 */
  --branding-ifsc-hi: #005aab;   /* hover */
  --tb-connect:       var(--branding-ifsc);
}
```

#### 4.8.2 Logo

```html
<img class="logo" src="qrc/resources/icons/IFSC_logo.png" alt="IFSC" />
```

资源来自 `/home/lu/qgroundcontrol/resources/IFSC_logo.png`，复制到 `qrc/resources/icons/IFSC_logo.png`。

#### 4.8.3 标题与 Favicon

```html
<title>IFSC-Station</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg ... fill='%2300427F'/%3E" />
```

Favicon 用 inline SVG data URI，省一个 HTTP 请求，主体色 `#00427F`。

---

### 4.9 一键启动脚本（start.py）

从"手动 `python3 -m http.server`"升级为一键脚本，解决三类问题：**端口/进程管理、SVG 与字体的 MIME 类型、WebSocket 桥接联动**。文件位于 `qgc-web/start.py`，纯标准库（`http.server` + `socket` + `subprocess` + `threading` + `argparse` + `urllib`），跨平台（Windows / macOS / Linux）。

**（1）MIME 类型注册（`_EXTRA_MIMES`）**

Python 3.11+ 的 `mimetypes` 把 `.svg` 默认注册为 `image/svg`，Chrome 不识别导致**所有 `<img src="*.svg">` 图标不渲染**。启动时先注册正确的 `image/svg+xml`（同时补 `.ttf/.woff/.woff2` 等字体 MIME，字体文件缺失 MIME 时 Firefox 也会拒绝）：

```python
_EXTRA_MIMES = { '.svg': 'image/svg+xml', '.svgz': 'image/svg+xml', '.ttf': 'font/ttf', ... }
for ext, mt in _EXTRA_MIMES.items():
    mimetypes.add_type(mt, ext)
```

**（2）端口可用性探测：BIND 探测而非 connect 探测（`is_port_in_use`）**

早期用 `socket.connect()` 探测端口，会把 **TIME_WAIT 状态的半关闭端口**误判为"服务在运行"。改用 `socket.bind()` 探测——能 bind 成功说明没有服务在听，最可靠：

```python
def is_port_in_use(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(('127.0.0.1', port))   # 能 bind 成功 → 端口空闲
        return False
    except OSError:
        return True
```

**（3）HTTP 存活探测（`is_http_alive`）**

BIND 探测只能说明"端口没被占"，不能说明"跑的是我们的网页"。启动时再发一次 `GET http://127.0.0.1:8000/`，返回 `<400` 才算已在运行 → **直接复用现有服务、打开浏览器后退出**，避免重复启动两个服务抢端口。

**（4）跨平台打开浏览器（`open_browser`）**

| 平台 | 方法 | 原因 |
|---|---|---|
| Windows | `os.startfile(url)` | 等同资源管理器双击，最可靠 |
| macOS | `subprocess.Popen(['open', url])` | |
| Linux | `subprocess.Popen(['xdg-open', url])` | 避免 `webbrowser` 模块在 headless/无 DISPLAY 环境下报错 |

用 `threading.Timer(0.5, ...)` 延迟 0.5s 打开浏览器，等 HTTP 服务完全就绪。

**（5）WebSocket 桥接联动（`start_bridge`）**

飞控已连接时（检测到 `/dev/ttyACM*` 或 `/dev/ttyUSB*`），脚本自动拉起 `ws_bridge.py`（`--port <dev> --ws 8766`），让浏览器**直接用 WebSocket 路径连接**（比 Web Serial 更稳定，见 5.23/5.24）。逻辑：

1. `is_port_in_use(bridge_port)` → 已有桥接在跑，跳过；
2. `find_serial_device()` → 无串口设备，打印提示跳过（不报错）；
3. `Popen` 启动桥接，Ctrl+C 退出时 `terminate()` 子进程。

命令行参数：

```bash
python3 start.py                 # 默认端口 8000, 自动开浏览器 + 自动启桥接
python3 start.py -p 9000         # 自定义 HTTP 端口
python3 start.py --no-browser    # 不自动开浏览器
python3 start.py --no-bridge     # 不自动启 WebSocket 桥接
python3 start.py --bridge-port 9000   # 自定义桥接端口
```

**验证**：`ss -tlnp` 确认 8766 有监听（桥接）且 8000 有监听（HTTP）；重复运行 `start.py` 不会重复起服务，而是直接复用并打开浏览器。

**经验**：启动脚本最容易踩的三个坑——① 端口探测方式（BIND vs connect）；② MIME 类型（浏览器对 SVG/字体类型很挑剔）；③ 子进程生命周期（桥接必须随主进程退出而回收，否则留下僵尸进程占着串口）。

### 4.10 Windows 一键启动脚本（start.bat）与服务器部署打包

#### 4.10.1 Windows 启动脚本（start.bat）

设计目标：Windows 10/11 / **Windows Server 2016+** 上**双击即用**、无需手敲命令，与 4.9 的 `start.py` 组合构成完整启动链：`start.bat`（找 Python）→ `start.py`（起 HTTP 服务 + 自动开浏览器 + 可选桥接）。文件位于 `qgc-web/start.bat`。

**版本演进：纯 ASCII 化**。早期 bat 含中文注释，曾因 `chcp 65001` 在部分环境（Win7/Server Core/某些 Windows Server 2022 区域配置）切换失败、且 echo 中文在 GBK 代码页下显示成 `儿脖 / 镖砒` 之类乱码。现行版本**全 ASCII**——`code page = GBK/UTF-8/1252/936/65001` 都一致正确显示，是工业级部署最稳的写法。

实现要点（逐行为什么这么写）：

```bat
@echo off
setlocal enabledelayedexpansion
REM ---- Detect Python: try py -3, then python3, then python ----
set "PY="
where py >nul 2>&1
if not errorlevel 1 set "PY=py -3"
if not defined PY ( where python3 >nul 2>&1 && set "PY=python3" )
if not defined PY ( where python  >nul 2>&1 && set "PY=python"  )
if not defined PY ( ... 提示安装并 pause, exit /b 1 ... )
echo. && echo ==================== ...
%PY% start.py %*           REM 参数透传
pause                      REM 窗口不闪退, 便于查看报错
```

1. **纯 ASCII 注释 + echo**：根本避免任何代码页下的中文乱码（实测在 Windows Server 2022 GBK / 中文 Win11 UTF-8 / 英文 Win11 CP1252 下均正常）。
2. **`cd /d "%~dp0"`**：`%~dp0` 是脚本所在目录，保证无论从哪个路径双击，都以网页目录为工作目录（`start.py` 依赖相对路径 `src/`、`qrc/`）。
3. **Python 探测顺序**：`py -3`（Python 官方安装器自带的 launcher，最高优先级）→ `python3` → `python`。`py -3` 展开后是"程序 `py` + 参数 `-3`"，经 `%PY%` 拼接后等价于 `py -3 start.py`。三个都找不到时给出下载提示（含"勾选 Add Python to PATH"的关键提醒）并 `pause` 等待用户查看。
4. **参数透传 `%*`**：`start.bat -p 9000 --bind 0.0.0.0` 会把 `-p 9000 --bind 0.0.0.0` 原样传给 `start.py`，复用 4.9 的全部命令行参数，无需在 bat 里重复解析。
5. **`pause` 兜底**：脚本尾部 `pause >nul` 防止窗口一闪而过；启动失败时先打印错误码和建议（如 `start.bat -p 9000` 换端口）。

> **乱码历史回顾**：在 V1.9 章节发布时曾用"中文注释 + `chcp 65001`"方案，但在 Windows Server 2022 上有用户报告全部 echo 都乱码（截图显示 `'儿脖'` 实际是 `'py'`、`'镖砒'` 实际是 `'端口'`）。根因是 `chcp 65001` 在该用户环境切换失败、而 bat 本身用了 GBK 编码（Windows 记事本默认）。**改纯 ASCII 后所有代码页下都正常**，是工业级部署最稳的写法。

Windows 使用说明：

| 场景 | 操作 |
|---|---|
| 本机使用 | 双击 `start.bat` → 自动打开 `http://localhost:8000/` |
| 连接飞控 | Windows 下浏览器用 **Web Serial 直接连**（见 4.2），无需 ws_bridge（`start.py` 在 Windows 上自动跳过桥接检测） |
| 局域网联调 | `start.bat --bind 0.0.0.0`，其他设备访问 `http://<本机IP>:8000/` |
| 换端口 | `start.bat -p 9000`（端口占用时自动顺延 8000-8010） |

#### 4.10.2 服务器部署打包

**打包规则**（zip 格式，跨平台通用，如 `IFSC-web-server.zip`）：

| 内容 | 说明 |
|---|---|
| `index.html` / `sw.js` | 页面入口 + Service Worker（瓦片持久化缓存，见 5.26） |
| `src/` | 全部前端逻辑（mavlink / telemetry / map / views / widgets） |
| `qrc/` | QGC 原始图标、字体、地图按钮资源 |
| `start.py` / `start.bat` / `start.sh` | 跨平台启动器三件套 |
| `ws_bridge.py` | MAVLink WebSocket 桥接（Linux 服务器直连飞控时用，需 `pip install pyserial`） |
| `mock_mavlink_server.py` | 模拟飞控（无硬件时验证页面功能） |
| **排除** `__pycache__/`、`.trae/`、`_test_*.html`、`qgc_test_runner.py`、`fix_mime_windows.*` | 开发/测试冗余（`start.py` 已内置 MIME 修复，注册表方案废弃） |

**服务器部署步骤**：

```bash
unzip IFSC-web-server.zip -d /opt/ifsc-web        # 1. 解压
cd /opt/ifsc-web
python3 start.py --bind 0.0.0.0 -p 8000           # 2. 外部可访问启动 (或 ./start.sh --bind 0.0.0.0)
sudo ufw allow 8000/tcp                           # 3. 防火墙放行 (如启用 ufw)
# 4. 浏览器访问 http://<服务器IP>:8000/
```

**部署限制（重要）**：
- **Web Serial 仅 localhost / HTTPS 可用**（见 2.3）。服务器上通过 `http://<IP>` 访问时，浏览器**禁止** Web Serial 连飞控。因此服务器部署用于验证页面功能（地图、UI、参数展示、日志界面）；实际飞控连接需在**本机 localhost** 打开页面，或服务器配置 HTTPS，或用 `ws_bridge.py` 把服务器串口转发给网页。
- `sw.js`（瓦片缓存）同样仅在 localhost / HTTPS 下注册，`http://IP` 访问时自动降级（不影响页面使用，仅瓦片不持久缓存）。

**验证**：
- Windows 双击：控制台出现"IFSC-Station 网页版启动器"，浏览器自动打开地图页并正常加载瓦片。
- 服务器：`curl -s -o /dev/null -w "%{http_code}" http://<IP>:8000/` 返回 `200`；`ss -tlnp` 可见 8000 监听。

---

## 5. 关键问题与解决方案

下面是开发过程中**真正卡过时间**的问题，按时间顺序记录。

### 5.1 飞控不响应 GCS HEARTBEAT

**症状**：网页连接后，右上角始终显示 "0 Hz · 无数据"，但 F12 控制台显示 GCS 一直在发 HEARTBEAT（0xFE/0x55 计数正常），飞控从未 ACK。

**根因**：[mavlink.js](file:///home/lu/qgc-web/src/mavlink.js) 的 CRC 表用 poly 0xA001（CRC-16/MODBUS），但 MAVLink 用的是 **CRC-16/MCRF4XX**（poly 0x8408 reflected）。PX4 收到 CRC 错的帧**静默丢弃**，不会 NAK。

**验证**：用 0xA001 算出的 HEARTBEAT CRC = `0xC53D`，PX4 期望 `0x5A98`。

**修复**：

```js
// 错
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 1) ? ((crc >>> 1) ^ 0xA001) : (crc >>> 1);
  }
}
// 对
    crc = (crc & 1) ? ((crc >>> 1) ^ 0x8408) : (crc >>> 1);
```

**经验**：MAVLink 规范文档 [mavlink.io](https://mavlink.io/en/guide/serialization.html) 写得很清楚，但很多人凭直觉用 0xA001。务必**从规范源码抄**而不是凭印象。

### 5.2 `FILE_TRANSFER_PROTOCOL` 帧被 PX4 丢弃

**症状**：发 ListDirectory 后，PX4 永远不回 ACK，FTP 完全死锁。

**根因**：[mavlink.js](file:///home/lu/qgc-web/src/mavlink.js) 的 `encodeFTPPayload()` 返回 244 字节，但 PX4 严格要求 **251 字节**（12 字节 FTP header + 239 字节 data）。短帧被 PX4 静默丢弃。

**修复**：把 payload 长度写死 239（data 部分用 NUL 填充）：

```js
function encodeFTPPayload(seq, session, opcode, reqOp, size, data) {
  const buf = new Uint8Array(251);
  // ... 填充 header 12 字节 ...
  // data 填到 buf[12..12+size]
  for (let i = 0; i < 239; i++) buf[12 + i] = data[i] || 0;
  return buf;
}
```

### 5.3 FTP 路径"FileNotFound"

**症状**：发 `dirPath="/fs/microsd/log"` 给 PX4，PX4 立刻 NAK `kErrFileNotFound`。

**根因**：PX4 `mavlink_ftp.c::_constructPath()` 内部：

```c
strncpy(path, _root_dir, sizeof(path));  // "/fs/microsd"
strncat(path, req_path, ...);
```

如果客户端发绝对路径 `/fs/microsd/log`，PX4 会拼成 `/fs/microsd/fs/microsd/log`，找不到。

**修复**：发相对路径 `""`（根）、`"log"`、`"log/sess100/log100.ulg"`。

**经验**：研究 QGC 源码时**要看 `_constructPath`** 之类的内部实现，不能只看 MAVLink 规范。

### 5.4 罗盘指针不转

**症状**：飞控 yaw 变化时，仪表盘上的罗盘 dial 完全不动，但 `state.attitude.yaw` 数值在变。

**根因**：[compass.js:56](file:///home/lu/qgc-web/src/widgets/compass.js#L56) 一开始写：

```js
ctx.rotate(-lastYaw * Math.PI / 180);
```

但 `lastYaw` 已经是**弧度**（来自 `angleDelta()`）。再乘 `PI/180` = 实际旋转 1/180，等于不动。

**修复**：

```js
ctx.rotate(-lastYaw);  // 已经是弧度
```

**经验**：单位的注释要与代码语义一致。`angleDelta()` 注释必须写明"返回弧度"。

### 5.5 日志列表解析失败

**症状**：ListDirectory ACK 收到 138 字节，console 打印 ASCII 是 `D2026-05-14\0D2026-05-18\0...`，但解析出 0 个条目。

**根因**：第一版解析器假设条目以 `\n` 结束，但 PX4 用 `\0` 结束，且目录条目格式是 `<type(D/F/S)><name>\0`，文件条目是 `<type(F)><name>\t<size>\0`。

**修复**：按 `0x00` 切分，按首字符判断 `D/F/S`：

```js
const parts = data.split('\0').filter(Boolean);
for (const p of parts) {
  const type = p[0];             // D / F / S
  const rest = p.slice(1);
  if (type === 'F') {
    const [name, size] = rest.split('\t');
    entries.push({ name, size: parseInt(size), mode: 'F' });
  } else {
    entries.push({ name: rest, size: 0, mode: 'D' });
  }
}
```

### 5.6 Web Serial 串口被占用

**症状**：浏览器 `requestPort()` 不弹出端口选择框（被 QGroundControl 占着）。

**根因**：Linux 上 `/dev/ttyACM0` 一次只能被一个进程打开。

**解决**：
- **临时**：`sudo fuser -k /dev/ttyACM0` 杀进程
- **正确**：关 QGC，只用网页端；或反之

### 5.7 缩放按钮图标"挤在一起"且不居中

**症状**：右上角三个黑色按钮，图标没有在按钮中居中。

**根因**：第一版用内联 SVG，手写路径让视觉重心偏移；第二版用 `place-items: center` 配合 `<svg>` 百分比尺寸，在某些响应式断点失效。

**最终方案**（仿 QGC `QGCMapToolButton.qml`）：

1. **复制 QGC 原始 SVG 资源**到 `qrc/resources/FlightMap/`（[ZoomPlus.svg](file:///home/lu/qgroundcontrol/src/FlightMap/Images/ZoomPlus.svg) 等）。
2. 用 `<img>` 引用这些资源，CSS `width: 100%; height: 100%; object-fit: contain; padding: 18%;`。
3. 按钮 `display: flex; align-items: center; justify-content: center;` 强制居中。

**经验**：UI 资源应该**从源头复制**，不要手绘 SVG。QGC 的 SVG 已经是像素级验证过的，复制过来就保证一致性。

### 5.8 主界面是"假地图"，替换为真实瓦片地图

**症状**：Fly 视图主界面是一张 SVG 网格 + 模拟色块 + 伪造地理背景拼成的"假地图"，没有真实道路/区域信息。

**根因**：V1.0 选型为离线手写 SVG，只能画"一个点 + 一条轨迹"。随着真实飞行演示需要，假地图必须移除。

**解决**（参考 QGC `src/QtLocationPlugin/` 与 `src/FlightMap/`）：

1. 瓦片源对齐 `EsriMapProvider.cpp`：街道/卫星/地形三种 **Esri ArcGIS XYZ 瓦片**（无需 token）。
2. 投影对齐 `MapProvider.cpp`：Web Mercator（`lon2px / lat2px / px2lon / px2lat`）。
3. 缩放/跟踪语义对齐 `FlightMap.qml`：±0.5 步进、maxZoomLevel 20、`keepMapCenteredOnVehicle`、首次定位自动居中。
4. 比例尺对齐 `MapScale.qml`：`_scaleLengthsMeters` 步长 + km 显示规则。
5. 删除假地图的 SVG 网格背景与死 CSS。

**经验**：QGC 的地图能力分两处——`src/QtLocationPlugin/`（瓦片源 + 投影）与 `src/FlightMap/`（交互 + UI），改造时两块都要参考。

### 5.9 卫星图没有区域名/街道名（Hybrid 标注叠加层）

**症状**：卫星影像瓦片是纯影像，看不到地名、街道名。

**根因**：卫星瓦片本身不含标注。QGC 的"卫星带标注"是单独叠加一层透明标注瓦片（即 HybridMap），且 QGC `FlightMap.SettingsGroup.json` 默认 `mapType` 就是 **Hybrid**。

**解决**：

1. 新增 `hybrid` 类型：卫星底图 + 透明标注叠加层（Esri 为 `Reference/World_Boundaries_and_Places`，高德为 `style=8` 路网注记瓦片）。
2. `renderTiles()` 为 Hybrid 在同位置渲染第二层 `labelLayer`（`pointer-events: none` 不挡拖拽），与底图共享同名 key 的瓦片坐标。
3. 切换地图类型时清空标注层缓存，避免残留旧瓦片。

**经验**："卫星图带街道标注"不是把标注画进卫星瓦片，而是叠加一层透明标注瓦片；默认地图类型用 Hybrid 与 QGC 保持一致。

### 5.10 高德地图坐标偏移（GCJ-02 火星坐标系）

**症状**：瓦片源换成高德后，飞行器 / HOME / 航迹与地图底图明显对不上，偏移约 300–500m。

**根因**：国内互联网地图（高德 / 腾讯 / Google 中国）强制使用 **GCJ-02 加密坐标系**，而 GPS / MAVLink 原始数据是 **WGS-84**。高德瓦片本身在 GCJ-02 网格上，WGS-84 坐标直接投影会整体偏移。

**解决**：

1. 内联实现 `wgs84ToGcj02()`（标准 coordtransform 算法：`a=6378245.0`、`ee=0.00669342162296594323`，境外不偏移）。
2. 补 `gcj02ToWgs84()` 差分迭代逆转换（一次迭代误差 < 1m）。
3. **渲染链路**：`toScreen()` / `renderTiles()` / `gcjCenter()` 全部先转 GCJ-02 再投影。
4. **交互链路**：拖拽 / 缩放 / `zoomAt()` 在 GCJ-02 像素空间计算，存回 `view.center` 时逆转为 WGS-84，保证内部状态始终与 MAVLink 一致。
5. `MAX_ZOOM` 调整为 18（高德瓦片最大级别）。

**经验**：接入国内地图服务商，第一步确认坐标系（高德 GCJ-02、百度 BD-09、天地图 CGCS2000/WGS-84）。GPS 数据不转换直接叠加会整体漂移。

### 5.11 高德瓦片加载失败（子域名不稳 + 无重试）

**症状**：切换高德后，控制台批量出现 `net::ERR_CONNECTION_RESET` / `net::ERR_TIMED_OUT`，失败瓦片集中在 `webstXX.is.autonavi.com`（不同网络环境下不稳定的子域名不同——早期是 `webst02`，后期 `webst01`/`webst04` 也出现），整片地图加载失败。

**根因**：高德瓦片有 `01–04` 四个子域名 CDN，在部分网络环境下个别子域名不可达（超时而非 404）。**第一版**只做固定轮换（`['01','03','04']` 跳过 02），失败瓦片不重试，遇到不可达子域名即整片加载失败。

**解决**（第二版，`src/widgets/map.js`）：

1. **失败自动换子域名重试**：每个瓦片 `<img>` 失败时，用其已记录的 `_tile = {style, z, x, y}` 参数换一个不同子域名重新请求，最多重试 2 次：
   ```js
   img._tile = { style: 6, z: z0, x: wx, y: ty };  // 创建时记录瓦片参数
   // error 回调中:
   img.src = buildAmapUrl(t.style, t.z, t.x, t.y, ++img._retries);
   ```
2. **健康子域名池**：子域名连续失败 2 次（`amapFailCount`）即被标记"病态"（`amapSick`）并从轮换池剔除，不再被请求；任一瓦片 `load` 成功则该子域名恢复健康：
   ```js
   const pool = AMAP_SUBS.filter(s => !amapSick.has(s));
   const list = pool.length ? pool : AMAP_SUBS;  // 全被剔除时回退全部
   return list[(x + y + (retry || 0)) % list.length];
   ```
3. **恢复完整子域名池**：`AMAP_SUBS` 由 `['01','03','04']` 扩回 `['01','02','03','04']`——健康池机制会自动规避不稳定子域名，无需再手工跳过。

**验证**：真实浏览器中 `webst01`/`webst04` 超时，重试机制触发 2 条 `[QGC-WEB] 高德子域名 webstXX 连接不稳定, 已切换其它子域名` 警告后，36/36 瓦片全部经 `webst03`/`webst02` 加载成功，病态子域名不再被请求。

**经验**：瓦片服务通常提供多个子域名做并发/负载均衡，接入时不要只依赖固定轮换——失败自动重试 + 动态健康池才能应对子域名 CDN 的不可靠性；正式接入仍建议申请官方 Key 并遵守服务条款。

### 5.12 浏览器自动化验证瓦片数量"异常"（视口假象）

**症状**：临时测试页诊断显示 128 个瓦片（DOM 上限）、`maxT≈4584` 远超视口高度、飞行器 Y 坐标 3477。

**根因**：**不是代码 bug**。浏览器自动化工具的视口实际高达 ~4608×1433 设备像素，瓦片行数 = 视口高 / 瓦片高 ≈ 18 行，128 上限被正常打满；正常 1386×570 视口下只有 18–24 张瓦片。

**解决**：确认视口真实尺寸后删除临时测试页与 `window.__mapDebug` 调试钩子。

**经验**：用自动化工具做像素级几何断言前，先确认视口的**设备像素** vs **CSS 像素**；几何异常先怀疑测量方式，再怀疑渲染逻辑。

### 5.13 顶部工具栏 Fly / Plan / Analyze / Setup 图标不显示

**症状**：顶部工具栏 5 个视图按钮中 Fly / Plan / Analyze / Setup 图标区域空白，只有文字标签；Params 图标正常。

**根因**：HTML 内联 `<svg>` 内的 `<style>` 是**文档级全局 CSS**，不会自动限定在自身 SVG 内。顶栏右侧 GPS/RC 状态指示器 SVG 的内嵌样式定义了 `.st0{display:none;}`，同特异性规则下按文档顺序后声明者胜出，级联作用于页面**所有** `class="st0"` 元素，将 4 个工具栏图标的所有几何路径全部隐藏（Params 图标为无类名手写 SVG，故不受影响）。

**解决**：给 GPS/RC 指示器 SVG 增加唯一 `id`（`gpsIndicatorIcon` / `rcIndicatorIcon`），并将其内嵌样式规则前缀为 `#gpsIndicatorIcon .st0{...}` / `#rcIndicatorIcon .st0{...}`，使规则只作用于自身 SVG 内部，不再全局泄漏。

**涉及文件**：`index.html`

### 5.14 顶部工具栏图标模糊

**症状**：替换修复后 4 个图标虽显示，但观感模糊（毛边感明显），Params 图标相对清晰。

**根因**：图标为 Illustrator 导出的复杂路径（72×72 单位设计），被 CSS 缩放到 ~18px（约 0.25 倍）渲染；在浏览器非整数 DPR（如 1.2）下，实际栅格为小数设备像素，43%–70% 的墨迹像素落在抗锯齿过渡带，高对比纯白图标进一步放大毛边感。

**解决**：
1. 将 4 个按钮的内联 SVG 替换为 `<img class="icon" src="qrc/resources/toolbar/…svg">`，直接引用 QGC 原始 SVG 资源（PaperPlane / Plan / Analyze / Gears）；
2. 提升图标尺寸至 `2.8vmin; min-width:22px; max-width:30px`，并加 `object-fit:contain`，降低小尺寸缩放的子像素渲染损失。

**涉及文件**：`index.html`、`src/styles.css`

### 5.15 Params 视图左侧工具条错误显示 Fly 按钮

**症状**：打开 Params 视图后，左侧工具条显示的是 Fly 视图的按钮（Fly / T/O / Land / RTL / Pause）。

**根因**：`STRIPS` 配置缺少 `params` 键，`renderToolstrip` 用 `STRIPS[view] || STRIPS.fly` 兜底，导致回退到 Fly 工具条。

**解决**：`STRIPS` 增加 `params: []`；`renderToolstrip` 在按钮列表为空时隐藏 `#toolstrip`（`toolstrip.style.display = items.length ? '' : 'none'`），使 Params 视图不再显示 Fly 按钮。

**涉及文件**：`src/app.js`

### 5.16 Setup 视图 Help 图标语义不清

**症状**：Setup 工具条 Help 按钮图标为"喇叭(Megaphone)"图形，语义与"帮助"不匹配，观感不清晰。

**解决**：复制 QGC 官方 `Help.svg`（圆圈问号）至 `qrc/resources/toolbar/Help.svg`，并将 Help 按钮改为 `<img class="ic">` 引用，与其它工具条按钮风格统一。

**涉及文件**：`qrc/resources/toolbar/Help.svg`（新增）、`src/app.js`

### 5.17 Plan 视图 Survey Pattern 按钮无图标

**症状**：Plan 工具条 Grid 按钮显示乱码文本 `qrc/resources/PatternGrid.png`，而非图标。

**根因**：双重问题——① `renderToolstrip` 只把 `.svg` 结尾的 `icon` 包成 `<img>`，`.png` 被当作纯文本直接输出；② `qrc/resources/PatternGrid.png` 文件不存在。

**解决**：
1. 从 QGC 复制 `PatternGrid.png` / `PatternCamera.png` / `PatternTerrain.png` 至 `qrc/resources/`；
2. `renderToolstrip` 改为任意 `icon` 文件均渲染为 `<img class="ic">`，不再限制文件类型。

**涉及文件**：`qrc/resources/PatternGrid.png` / `PatternCamera.png` / `PatternTerrain.png`（新增）、`src/app.js`

### 5.18 汉堡菜单视图图标模糊、工具条首按钮图标尺寸不一致

**症状**：汉堡菜单中 Fly / Plan / Analyze / Setup View 四个图标模糊；各视图工具条**第一个**按钮图标大小与其它按钮不一致且模糊。

**根因**：两处都使用**无 class 的内联 Illustrator SVG**。无 class 则 `.toolstrip-btn .ic`（60% 宽度）等样式不生效，渲染尺寸不受控；复杂路径在小尺寸 + 非整数 DPR 下再次出现模糊。

**解决**：将 `STRIPS` 各视图首按钮与汉堡菜单 `viewItems` 的内联 SVG 全部替换为 `icon: 'qrc/resources/toolbar/…svg'`，统一以 `<img class="ic">` 渲染。修复后工具条首按钮与其它按钮尺寸完全一致（均为按钮宽度 60%），汉堡菜单图标 22×22px 清晰渲染。

**涉及文件**：`src/app.js`

### 5.19 图标使用约定（防复发）

1. **不要在内联 SVG 中使用通用类名（`st0`/`st1`/…）的内嵌 `<style>`**：内联 SVG 的 `<style>` 是文档级全局 CSS，会与其它 SVG 的同名类冲突并互相覆盖。若必须使用内嵌样式，用唯一 `id` 前缀作用域化（如 `#gpsIndicatorIcon .st0`）。
2. **图标统一从 `qrc/resources/toolbar/` 引用 QGC 原始 SVG，以 `<img>` 渲染**：避免内联复杂路径在小尺寸下的模糊，以及类名/样式泄漏问题；工具条图标用 `class="ic"`（宽度 60%），顶部工具栏图标用 `class="icon"`（22–30px）。
3. **工具条/菜单图标渲染器支持任意文件类型**（`.svg` / `.png`），无需按扩展名分支。
4. 浏览器强缓存可能导致改动不生效，联调时使用带版本号 URL 或强制刷新（Ctrl+Shift+R）。

### 5.20 地图上无飞控图标 / 点击居中无反应

**症状**：连接飞控后，地图上没有任何飞行器图标、航迹、HOME 标记；点击"居中飞行器"按钮也没有反应。

**排查过程**：

1. 先怀疑是 `map.js` 的 `drawTelemetry` 或居中逻辑 bug，用浏览器自动化逐项检查了地图覆盖层（`#mVehicle` / `#mHome` / `#mTrail`），发现覆盖层代码本身正常——只有在 `state.path` 有数据时才会渲染图标。
2. 用 `window.__debug()` 查看实时遥测，发现 `pathLength: 0`、`position: {lat:0, lon:0}`，即**根本没有收到有效坐标**。
3. 对照 QGC `Vehicle.cc _handleGlobalPositionInt()` 确认了根因：**ArduPilot/PX4 在无 GPS 锁定时仍会发送 GLOBAL_POSITION_INT，坐标是无效的 (0,0)**。该消息被我们此前加入的 (0,0) 过滤逻辑正确丢弃了——飞控在室内（无卫星信号），所以地图永远拿不到有效坐标。

**根因**：飞控 GPS 未锁定（室内/无天线），`gps.fix_type < 3`，GLOBAL_POSITION_INT 持续发 (0,0)。这是**数据源问题而非渲染 bug**。

**解决**（两层）：

1. **诊断层**：新增 `window.__debug()` 控制台工具 + 状态面板 GPS fix 行。用户能一眼看出当前是 `No Fix` 还是 `3D`，不再"盲猜"图标为什么没出现。
2. **提示层**：LAT/LON 字段在无有效坐标时显示红色 `No GPS` 而非默认 `0.000000`。

**次要 bug**：初始 HTML 中 LAT/LON 写死为 `0.000000`，而飞控未连接时 `state=null`，`updateFlyView` 直接 `return`，导致用户看到 `0.000000` 误以为"有坐标但图标不显示"。修复为初始值直接写 `No GPS`。

**涉及文件**：`src/telemetry.js`、`src/views/flyview.js`

**经验**：室内测试飞控定位时，只要 GPS fix_type < 3，地图就必然没有图标——这不是代码问题。判断标准：状态面板 GPS 行必须显示绿色 `3D · N sats` 后，地图图标才会出现。

---

### 5.21 网页版无法读取飞控速度信息

**症状**：连接飞控后，GSPD / ASPD / VSPEED 全部恒为 0，其余数据（姿态、位置、电池）正常。

**排查过程**：

1. 先怀疑是 UI 渲染问题，检查 `flyview.js` 的 GSPD / ASPD / VSPEED cell，渲染代码本身没问题——是 `state.velocity` 里压根没有数据。
2. 用桌面端 QGC 对比确认速度来源。查 QGC 源码 `Vehicle::_handleVfrHud`（`src/Vehicle/Vehicle.cc` L986）：**空速 / 地速 / 爬升率三个 Fact 全部来自 VFR_HUD（msgid 74），不是 GLOBAL_POSITION_INT**。
3. 检查网页端，发现三个独立 bug 叠加：

**根因**（三个）：

1. **`mavlink.js` 的消息表里没有 VFR_HUD**——解析器收到 74 号消息时走 unknown 分支丢弃，字段永远解析不出来。
2. **`STREAM_REQUESTS` 把 msgid 写错**——早期版本写成 `[105, 1, 'VFR_HUD']`。105 实际是 `HIGRES_IMU`，VFR_HUD 是 **74**。结果 `MAV_CMD_SET_MESSAGE_INTERVAL` 请求错消息，飞控从不推送 VFR_HUD。
3. **GLOBAL_POSITION_INT 分支用 `hypot(vx,vy)/100` 强行覆盖 `airspeed`**——即使以后收到 VFR_HUD 也会被覆盖成地速。

**解决**：

1. `mavlink.js` 新增 VFR_HUD 消息定义（见 4.2.8），`crcExtra = 20`。
2. `STREAM_REQUESTS` 改为 `[74, 4, 'VFR_HUD']`（4 Hz）。
3. `handleMessage` 新增 VFR_HUD 分支；GLOBAL_POSITION_INT 分支改为"收到 VFR_HUD 后不再覆盖 airspeed"。
4. **字段布局陷阱**：VFR_HUD 的 C 库线上布局（mavgen 按 4 字节对齐重排）是 `airspeed@0, groundspeed@4, alt@8, climb@12, heading@16, throttle@18`——**alt 在 climb 之前**，与 XML 声明顺序（heading 在前、alt/climb 在后）不同。第一版按 XML 顺序写反了 alt/climb，用 pymavlink 真值解码对比抓出：打出来的值变成 `alt=1.5, climb=120`（值对调）。

**涉及文件**：`src/mavlink.js`、`src/telemetry.js`、`src/views/flyview.js`、`ifsc_test/test_vfr_hud.py`

**经验**：MAVLink 消息字段布局要以 mavgen 生成的 C 库（`mavlink_msg_*.h` 的 `_mav_put_*` 顺序）为准，不能只看 XML 声明顺序。凡是手工解析的消息，都用 pymavlink 解码真值对比验证一遍。

---

### 5.22 PX4 v1.17 升级后通信全面冻结

**症状**：固件从旧版升级到 PX4 v1.17.0 后，网页端连接飞控出现全链路冻结——姿态信息读不到、参数列表读取一部分就停止、右上角 MAVLink 通信频率不动、日志拉取报 `FTP 操作超时 (10s)`。

**排查过程**：

1. 先怀疑 MAVLink v2 / CRC 问题：检查 v1.17 的 `MAV_PROTO_VER`（默认 v2）、`_HASH_CHECK` 参数（idx=65535）、CRC 表，全部正确。
2. 用 pymavlink 真值工具对抓包做逐帧解码，FTP / 参数 / 姿态消息本身都能被正常解析——**飞控端发送是好的**。
3. 最后定位到网页端**读取循环**：`parser.onMessage` 里一旦某条消息的处理函数抛异常，异常会沿 `await reader.read()` 的循环冒泡，把整个串口读取循环杀死——且**没有任何报错提示**，界面表现为"一切静默冻结"。

**根因**：v1.17 固件新增/变更了某些消息内容（如参数列表的 `_HASH_CHECK` 索引项、SYS_STATUS 字段变化），网页端旧代码的 `handleMessage` 遇到新数据形态抛异常 → 读取循环死亡 → 姿态 / 参数 / FTP 全停。单个异常就能让整个链路静默停摆，是这类问题最难排查的原因。

**解决**（四层防护，`src/telemetry.js`）：

1. **`parser.onMessage` 内 try/catch**：单条消息处理异常只记 `console.error` + 状态栏提示，**绝不抛出**，保证读取循环永远存活。
2. **读取循环自动恢复**：`startSerialReadLoop()` 的 read 循环意外退出（stream done / 异常）时，`scheduleReadLoopRestart()` 在 30s 窗口内最多自动重启 5 次，防止反复崩溃死循环；超过 5 次明确提示"请断开重连"。
3. **链路看门狗**：已连接但 4s 无任何 MAVLink 消息时，每 2s 输出 `parser.stats`（bytes / frames / crcFail / delivered / unknown）+ `lastMsg` + `readLoopAlive`，把"故障在哪一层"直接打在控制台上。
4. **诊断挂钩**：`window.__qgc_parser`（可看 `parser.stats`）与 `window.__qgc_lastMsgName`（最后处理的消息名），配合 `localStorage.setItem('qgc-debug','1')` 可定位是 CRC 错（crcFail 增长）、消息未交付（delivered 停滞）还是处理异常。

**涉及文件**：`src/telemetry.js`、`src/mavlink.js`

**经验**：串口读取循环是单点，任何一处未捕获异常都能让整个遥测静默死亡。凡长驻循环都必须保证"一层异常不杀死循环"，并配套看门狗输出故障层统计。

---

### 5.23 Web Serial 打开即报 "device has been lost"

**症状**：PX4 v1.17 固件 + Pixhawk 6C Mini（FMU v6C）USB 口，网页端点 Connect → 选端口后立刻弹 `NetworkError: The device has been lost.`，姿态 / 参数 / 日志全失效。桌面端 QGC 用同一根 USB 线一切正常。

**排查过程**：

1. 先排除端口占用：用户确认从不把网页端和桌面端同时运行（同一时间只有一方连飞控），所以"串口被 QGC 占用"不是原因。
2. 检查网页端发送链路：GCS HEARTBEAT 在正常发送（事件循环活着），是**接收侧**挂掉。
3. 关键证据来自 `dmesg`：连接时 USB 设备反复重新枚举，串口里出现 `PX4 BL FMU v6C.x`（bootloader 字符串）与 `PX4 FMU v6C.x`（固件字符串）**交替出现**——说明 **Web Serial 的 `port.open()` 触发了飞控 USB 复位，飞控重启进了 bootloader**，Chrome 随即报 device lost。

**根因**：Pixhawk 6C 的 USB CDC 口对打开方式敏感——浏览器 Web Serial `open()` 时 DTR/控制线变化会触发 FMU v6C 的 USB 复位并重新枚举进 bootloader。这是**固件/硬件层面与 Web Serial 打开方式的兼容性问题**，不是网页代码 bug，也不是端口占用。桌面端 QGC 的串口打开方式不同（不触发复位），所以一切正常。

**解决**（`ws_bridge.py`，见 4.3）：

1. 用 pyserial 打开串口（与 QGC 同级别的稳定打开方式），**整个程序生命周期内保持打开**，绝不反复 open/close。
2. 浏览器不再直连 USB，改为连接 `ws://localhost:8766`，MAVLink 字节流由桥双向透传。
3. 网页端 Connect 弹窗新增 WebSocket Bridge 模式，帮助文本说明"部分飞控（Pixhawk USB 口）对 Web Serial 直连会触发 USB 复位，桥模式更稳定"。

**涉及文件**：`ws_bridge.py`（新建）、`src/app.js`（连接弹窗加 WS 模式与提示）

**经验**：Web Serial 直连 USB CDC 飞控不是在所有固件/硬件上都稳定。遇到 `device has been lost` 时先看 `dmesg` 确认是否 USB 重新枚举（出现 bootloader 字符串即实锤），然后改走"本地桥"方案。此桥对任意 Pixhawk 6C / FMU v6C 设备通用，因为问题出在打开方式而非具体型号。

### 5.24 WebSocket 连接失败（ws://localhost:8766 refused）

**症状**：网页端 Connect 弹窗选 WebSocket Bridge、填 `ws://localhost:8766` 后一直连接失败，控制台报 `WebSocket connection to 'ws://localhost:8766/' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED`；同时地图瓦片大量 `ERR_CONNECTION_RESET` / `ERR_TIMED_OUT`（两问题同期出现，一度怀疑互相有关联）。

**排查过程**：

1. `ss -tlnp | grep 8766` → **无任何监听**，证明桥接服务根本没启动（不是连不上，是服务不存在）。同理瓦片加载失败是子域名 CDN 问题（见 5.11），与 WebSocket 无关，只是恰好同时出现。
2. 单独 `python3 ws_bridge.py` 手动启动后，`ws://localhost:8766` 立即连通 → 坐实"start.py 只管 HTTP，不管桥接"的缺口。
3. 期间还观察到"串口不存在"假报错：桥接刚启动时飞控 USB 瞬时复位重枚举，`glob('/dev/ttyACM*')` 短暂为空；稍等重试即可。

**根因**：`start.py` 第一版只启动了 HTTP 服务；WebSocket 桥接需要另开终端手动运行。用户不知道/忘记启动桥接 → 连接被拒。这是**使用流程问题**，不是桥接代码问题。

**解决**（`start.py` 增加桥接联动，见 4.9 第 5 点）：

1. 启动时自动 `find_serial_device()` 检测 `/dev/ttyACM*`/`/dev/ttyUSB*`，检测到飞控就用 `Popen` 拉起 `ws_bridge.py --port <dev> --ws 8766`；
2. 端口 8766 已被占用说明桥接已在跑 → 跳过不重复启动；
3. 无串口设备时打印提示、静默跳过（不报错，用户仍可用 Web Serial 直连）；
4. Ctrl+C 退出主服务时 `terminate()` 桥接子进程，避免僵尸进程占着串口；
5. 提供 `--no-bridge` / `--bridge-port` 参数按需覆盖。

**验证**：`python3 start.py` 启动后 `ss -tlnp` 同时看到 8000（HTTP）与 8766（WS 桥接）监听；浏览器 Connect → WebSocket Bridge → `ws://localhost:8766` 一次成功。

**涉及文件**：`start.py`（新增 `start_bridge` / `find_serial_device` / `--no-bridge` / `--bridge-port`）

**经验**：诊断"连接被拒"第一步永远是确认**服务进程是否存在**（`ss -tlnp` / `ps`），不要先怀疑协议或代码；一键脚本应当承担"基础设施编排"职责——把 HTTP、桥接等所有依赖进程统一拉起并统一回收，而不是让使用者手动凑齐多个终端。

### 5.25 地图瓦片加载慢（子域名不可达 + TLS 握手延迟）

**症状**：网页版打开后地图区域长时间空白/模糊，瓦片一张张慢慢出现；偶发某一块区域持续空白数秒。

**排查过程**（curl 实测，不猜）：

1. `curl -w` 计时 4 个子域同一瓦片：TLS 握手 `0.51–0.86s`、单瓦片总耗时 `1.0–1.8s`（正常 CDN 应 <100ms）——网络到高德线路延迟高。
2. 连续复测 `webst02`：`time_total 8s / 0B`（TCP 连通但 TLS/HTTP 无响应），判定该子域当前网络下**完全不可达**；`webst01/03/04` 正常（1.0–1.8s）。
3. 查看响应头 `cache-control: max-age=3600`——1 小时内重复访问浏览器走 HTTP 缓存，慢集中在**首次打开 / 清缓存 / 换网络**场景。

**根因**：

1. **网络延迟高**：TLS 握手单次 0.5–0.9s，每张新瓦片请求都要先付一个握手往返（浏览器每域最多 6 并发）。
2. **坏子域拖累**：瓦片按 `(x+y)%4` 轮换子域，约 1/4 概率轮到 `webst02`；5.11 的失败重试只在**报错后**换域，首次请求轮到坏子域仍要空等浏览器超时（实测 8–10s）才触发 error。首屏 12–24 张瓦片若夹杂几张坏子域，整图加载被明显拖慢。

**解决**（两层，`src/widgets/map.js` + `index.html`）：

1. **启动健康探测**（事前规避，`map.js`）——模块加载时并行探测全部子域，坏的在瓦片请求开始前就被剔除：

   ```js
   const PROBE_TIMEOUT_MS = 2500;
   const PROBE_TILE = { z: 12, x: 3415, y: 1686 };   // 杭州附近固定瓦片
   async function probeAmapSub(sub) {
     const url = `https://webst${sub}.is.autonavi.com/appmaptile?style=6&x=${PROBE_TILE.x}&y=${PROBE_TILE.y}&z=${PROBE_TILE.z}`;
     const ac = new AbortController();
     const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
     try {
       const r = await fetch(url, { signal: ac.signal });
       if (!r.ok) throw new Error('HTTP ' + r.status);
       if (r.body) await r.body.cancel();   // 等 headers 即可, 不下载瓦片内容
     } catch {
       amapFailCount[sub] = (amapFailCount[sub] || 0) + 1;
       amapSick.add(sub);                    // 复用 5.11 的健康池
       console.warn(`[QGC-WEB] 高德子域名 webst${sub} 健康探测失败, 本次会话已剔除`);
     } finally { clearTimeout(timer); }
   }
   for (const s of AMAP_SUBS) probeAmapSub(s);   // 模块加载即启动, 不阻塞页面
   ```

   - 探测用 `fetch`（高德返回 `access-control-allow-origin: *`，跨域可用）；
   - 2.5s 超时用 `AbortController` 掐断；失败直接进 `amapSick`——`amapSub()` 的 `pool.filter(s => !amapSick.has(s))` 会自动避开它；
   - 探测瓦片选固定小瓦片（z12），只等响应头不读 body（`r.body.cancel()`），4 个子域并行开销可忽略。

2. **preconnect 预连接**（省握手，`index.html`）——页面解析时提前完成健康子域的 DNS+TCP+TLS 握手：

   ```html
   <link rel="preconnect" href="https://webst01.is.autonavi.com" />
   <link rel="preconnect" href="https://webst03.is.autonavi.com" />
   <link rel="preconnect" href="https://webst04.is.autonavi.com" />
   ```

   - 浏览器在加载 HTML 的**同时**并行握手，等瓦片请求发出时连接已就绪，0.5–0.9s 的握手从每个瓦片的加载路径上移除；
   - 只对探测确认健康的子域 preconnect（当前环境 02 剔除，故只列 01/03/04），避免浪费连接。

**验证**：浏览器 Network 面板首张瓦片不再出现 TLS 握手阶段（连接复用，`time to first byte` 大幅下降）；`webst02` 的瓦片请求在控制台**完全不出现**（探测阶段即剔除）；curl 实测单瓦片总耗时由 1.8s 降至 ~0.5s（省去握手）。

**涉及文件**：`src/widgets/map.js`（`probeAmapSub` / `PROBE_TIMEOUT_MS` / `PROBE_TILE`）、`index.html`（`<link rel="preconnect">`）

**经验**：
- 排查"加载慢"先实测（`curl -w` 拆 DNS/连接/TLS/首字节/总耗时），不要凭感觉猜代码；
- CDN 多子域：失败重试是**事后**补救，启动健康探测才是**事前**规避——两者配合才不留 10s 空等；
- TLS 握手是跨网/CDN 场景加载慢的常见大头，`<link rel="preconnect">` 是最便宜的优化手段；
- 健康池（`amapSick`）是全局共享状态，探测结果天然融入 5.11 的轮换逻辑，无需另建一套。

---

### 5.26 地图瓦片持久化缓存（Cache API / Service Worker）

**背景**：QGC 桌面版地图秒开的根源是 QGCMapEngine 的 **1GB 本地磁盘缓存**（SQLite，[QGCMapEngine.cpp](file:///home/lu/qgroundcontrol/src/QtLocationPlugin/QGCMapEngine.cpp)，瓦片下载一次永久使用，先查内存→再查磁盘→最后才走网络）。而网页版此前只有**内存 Map**（页面刷新即清空）+ 浏览器 **1 小时 HTTP 缓存**（高德响应 `cache-control: max-age=3600`），导致每次打开页面都要重新从高德下载 12~24 张瓦片，实测每张 1.0~1.8s——这是"网页版比 QGC 慢很多"的根本差异。

**目标**：用浏览器 Cache API 实现 QGC 磁盘缓存的等价物——瓦片**持久化**到本地（永久有效、不受 max-age 限制、可离线），二次打开秒开。

**方案选型**：Cache API + Service Worker（对比 IndexedDB：SW 在 `fetch` 层透明拦截，**对现有 img 渲染代码零侵入**；IndexedDB 需自行管理二进制存取且要改加载流程）。

**实现步骤**：

1. **新建 `sw.js`**（项目根目录，与 index.html 同源）：

   ```js
   const CACHE_NAME = 'ifsc-tiles-v1';
   // 只拦截高德瓦片请求, 其余全部放行
   const TILE_PATTERN = /^https:\/\/webst\d{2}\.is\.autonavi\.com\/appmaptile\?/;
   const MAX_CACHE_ENTRIES = 20000;   // 条数上限, 超限删最早
   const TRIM_EVERY = 20;             // 每写 20 次才遍历一次 key 列表 (keys() 有成本)
   let _writeCount = 0;

   // URL 规范化: webst01~04 统一为 webst00 作缓存 key,
   // 同一瓦片经不同子域只存一份, 子域切换/失效不影响命中
   function normalizeUrl(url) {
     return url.replace(/webst\d{2}\.is\.autonavi\.com/, 'webst00.is.autonavi.com');
   }
   // 健康探测 (带 &probe=1) 必须走真实网络, 不读缓存
   function isProbe(url) { return /[?&]probe=1/.test(url); }

   async function trimCache(cache) {
     try {
       const keys = await cache.keys();
       if (keys.length <= MAX_CACHE_ENTRIES) return;
       const excess = keys.length - MAX_CACHE_ENTRIES;
       for (let i = 0; i < excess && i < 200; i++) await cache.delete(keys[i]);
     } catch {}
   }

   async function fetchTile(request) {
     try { return await fetch(request, { mode: 'cors' }); }  // cors 可校验 status
     catch { return await fetch(request); }                  // 降级 no-cors (opaque)
   }

   async function cacheFirst(request) {
     const cache = await caches.open(CACHE_NAME);
     const cacheKey = normalizeUrl(request.url);
     const hit = await cache.match(cacheKey);   // 1) 命中 → 直接返回 (毫秒级/离线)
     if (hit) return hit;
     const resp = await fetchTile(request);     // 2) 未命中 → 网络 + 写缓存
     // cors 成功: status===200 才缓存; opaque (status=0): 瓦片 URL 稳定正确也缓存
     if (resp.status === 200 || (resp.type === 'opaque' && resp.status === 0)) {
       await cache.put(cacheKey, resp.clone());
       if (++_writeCount % TRIM_EVERY === 0) trimCache(cache);
     }
     return resp;
   }

   self.addEventListener('install', () => self.skipWaiting());   // 立即接管
   self.addEventListener('activate', (event) => {
     event.waitUntil((async () => {
       const names = await caches.keys();
       await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
       await self.clients.claim();
     })());
   });
   self.addEventListener('fetch', (event) => {
     const url = event.request.url;
     if (!TILE_PATTERN.test(url)) return;   // 非瓦片放行
     if (isProbe(url)) return;              // 探测放行 (网络优先)
     event.respondWith(cacheFirst(event.request));
   });
   ```

2. **index.html 注册 SW**（页面 load 后注册，失败静默降级）：

   ```html
   <script>
     if ('serviceWorker' in navigator) {
       window.addEventListener('load', function () {
         navigator.serviceWorker.register('sw.js').catch(function () {});
       });
     }
   </script>
   ```

3. **map.js 健康探测加 `&probe=1` 标记**——让 SW 识别并放行（否则探测请求命中旧缓存会误报"子域健康"）：

   ```js
   const url = `https://webst${sub}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}&probe=1`;
   ```

**关键设计点**：

- **缓存优先 + 只缓存成功响应**：cors 模式校验 `status===200`，避免把 4xx 错误页缓存下来；网络失败（fetch reject）不产生缓存。
- **opaque 响应兼容**：个别环境跨源 cors fetch 不可用（如 Trae 内置 Electron 沙箱），降级 no-cors 得到 opaque 响应（status=0）——瓦片 URL 稳定正确，也写入缓存，保证持久化在无 CORS 环境同样生效。浏览器原生 img 加载不受影响（img 本就 no-cors）。
- **URL 规范化**避免同一瓦片多子域重复缓存（省磁盘且命中率最高）。
- **条数上限 20000 + 节流 trim**：防无限增长，`keys()` 遍历有成本故每 20 次写入才检查一次。
- **版本管理**：`CACHE_NAME` 固定 `ifsc-tiles-v1`，仅当缓存策略变更时 bump 版本；activate 阶段自动清理旧版本残留。sw.js 脚本本身由浏览器按字节变化自动更新（`skipWaiting` + `clients.claim` 立即生效）。
- **与既有优化兼容**：健康探测（5.25）走网络不读缓存；preconnect（5.25）属连接层无冲突；失败换子域重试命中规范化 key 直接返回缓存。

**平台限制**：Service Worker 仅 **localhost / https** 生效（`file://` 打开时注册失败自动降级为无缓存，功能不受影响）；Cache Storage 配额由浏览器管理，条数上限兜底。

**验证**（browser_use 实测）：
- `navigator.serviceWorker.getRegistrations()` → scope `http://localhost:8000/`、`active`，页面 `controlled`；
- `caches.open('ifsc-tiles-v1')` → **36 条**瓦片（z15 底图 style=6 + 标注 style=8 成片缓存），key 均为规范化的 `webst00.is.autonavi.com`；
- 刷新后条数不减少——持久化生效。

**涉及文件**：`sw.js`（新建）、`index.html`（注册脚本）、`src/widgets/map.js`（探测 URL 加 `&probe=1`）

**经验**：
- 网页版慢 vs 桌面版快的核心差异**不是并发或网络**，而是**持久化缓存**——浏览器 Cache API 是 QGC 磁盘缓存的直接等价物；
- Cache API 配 Service Worker 是对现有渲染代码**零侵入**的缓存方案（拦截层透明）；`cache.put` 前先 `resp.clone()`，否则响应体已被消费；
- no-cors 的 opaque 响应**可以**缓存（Chrome 支持），无法校验 status，但对 URL 稳定的资源是安全的——比"缓存失败"更划算；
- 跨源缓存场景一定要用**规范化 key**，否则 CDN 子域轮换会让缓存命中率大打折扣。

---

### 5.27 IFSC-Station 控制器切换功能（IFSC_DIST_SW / param_control）

**背景**：IFSC-Station 的扰动量切换（Disturbance Switch）需要在 **PID / LQR(INDI) / MPC** 三种控制器之间切换。设计依据见《IFSC-Station_专利技术交底书》。固件侧通过新增 `param_control` 模块暴露切换参数 `IFSC_DIST_SW`，地面站（QGC / 网页版）读取并设置该参数完成切换。

**固件端实现**（`src/modules/param_control/`，模块名即 "IFSC-Station placeholder"）：

1. **参数定义**（`module.yaml`，PX4 构建期自动生成参数元数据）：
   ```yaml
   module_name: IFSC-Station placeholder
   parameters:
       - group: IFSC Station
         definitions:
           IFSC_DIST_SW:
               description:
                   short: Disturbance Switch
                   long: |
                       Select which controller handles wind / disturbance rejection
                       for IFSC-Station.
                       0: PID Control (default). The built-in PID controller is used.
                       1: LQR (INDI) Control. The LQR controller, implemented mainly
                          via Incremental Nonlinear Dynamic Inversion (INDI).
                       2: MPC Control. The Model Predictive Control controller.
               type: enum
               values:
                   0: PID Control
                   1: LQR (INDI) Control
                   2: MPC Control
               default: 0
               category: Standard
   ```
   枚举语义：**0 = PID（默认内置） / 1 = LQR(INDI) / 2 = MPC**。

2. **切换检测逻辑**（`demo.cpp`）：模块订阅 `vehicle_local_position`，在 `Run()` 中用 `_last_ifsc_dist_sw` 做**边沿检测**——参数变化时通过 `PX4_INFO` 打印切换事件：
   ```
   [IFSC] Disturbance Switch -> MPC Control (2). MPC controller selected.
   [IFSC] Disturbance Switch -> LQR (INDI) Control (1). LQR/INDI controller selected.
   [IFSC] Disturbance Switch -> PID Control (0). Default built-in PID controller active.
   ```
   关键点：`init()` 中先同步一次 `_last_ifsc_dist_sw`（只对*变化*做出反应，避免启动即误报）；真实控制器接入后应在此处切换到对应控制器实现，目前为日志占位。

3. **编译接入**：
   - `Kconfig`：`menuconfig MODULES_PARAM_CONTROL`（默认 n），`USER_PARAM_CONTROL` 为受保护内存的用户态变体；
   - `boards/px4/fmu-v6c/default.px4board`：`CONFIG_MODULES_PARAM_CONTROL=y`；
   - `ROMFS/.../init.d/rcS`：`param_control start`（置于 `payload_deliverer start` 之后）。

4. **QGC 参数元数据**：`PX4ParameterFactMetaData.xml` 中维护 `IFSC_DIST_SW` 的枚举（0/1/2），使 QGC 参数面板以下拉框形式展示三档切换（需与固件 `module.yaml` 保持同步）。

**网页端方案演进（关键问题与决策）**：

1. **问题**：重新烧写飞控固件后，网页版地面站不显示 `IFSC_DIST_SW` 参数——因为当时的固件（`px4_fmu-v6c_default(2).px4`）并不包含该参数。
2. **方案 A（临时，已否决）**：网页本地参数注入——在网页端伪造 `IFSC_DIST_SW` 参数并展示，不重烧固件。缺点：参数是"假的"，与飞控真实参数通道不一致，无法真实生效。
3. **方案 B（最终采用）**："不要本地参数"。把控制器切换功能**真正写进固件**：以固件(2) 的定制为基准（septentrio 双 GPS、6003_fully_actuated_hexa 机架），合并本机 `param_control` 模块与全驱动源码，重新编译固件，使 `IFSC_DIST_SW` 成为固件原生参数，网页/QGC 走真实 PARAM 通道读取与设置。

**固件合并与验证（形成固件(4)）**：

1. **源码合并**：克隆 `fully_actuated_hexav1.17`（分支 `fullycontrol-1.17.0`，即固件(2) 的源码来源），将其中 25 个全驱动控制文件合并进本机 PX4-Autopilot：`mc_pos_control`（`MPC_FA_MODE`/`MPC_FA_RC_AUX` 参数、`thrustNedToBody`、Pose 模式）、`control_allocator`（Fx/Fy/Fz 统一推力尺度）、`mc_att_control`（`MPC_FA_STAB`/`MPC_FA_XY_THR`/`MPC_FA_XY_RATIO`）、机架 `6003_fully_actuated_hexa`（几何与固件(2) 一致）等；保留本机 `param_control`、septentrio、rcS 的 `param_control start`、px4board 定制。
2. **MPC_FA_MODE 语义演进**：固件(2) 为早期提交（`gd91715dacd`），`MPC_FA_MODE` 为 0/1/2 三档；仓库最新代码（`958d0a6bb8`）已演进为 0/1 两档 + `MPC_FA_STAB`（Stabilized 全驱动）。新固件采用源码最新方案。
3. **FLASH 裁剪**：实体固件 FLASH 占用 98.09%，为容纳 `param_control` 裁掉了 SIH 仿真模块（`CONFIG_MODULES_SIMULATION_SIMULATOR_SIH`），不影响实体飞行。
4. **解包验证**：`.px4` = JSON 头（`magic:"PX4FWv1"`、`image` 字段内嵌 base64）+ zlib 压缩体；解压后按 CROMFS 结构（`cv_magic` "CROM"、`cv_bsize`=512、节点链 peer/child、LZF 块）提取 ROMFS。验证结果：机架脚本含 `MPC_FA_MODE 1`、`MPC_FA_STAB 1`；`rcS` 含 `param_control start`；`rc.autostart` 的 `SYS_AUTOSTART 6003` 映射 `6003_fully_actuated_hexa`；`rc.serial` 含 septentrio 启动段；参数表（2000 组）含 `IFSC_DIST_SW` 及全部 6 个 MPC_FA 参数。

**当前状态**：固件侧已完成（固件(4) 已烧写验证路径），`IFSC_DIST_SW` 为固件原生参数。网页版/QGC 端参数读取显示需通过真实 PARAM 通道落地（网页版参数视图、QGC 元数据同步）。

**涉及文件**：`src/modules/param_control/`（module.yaml / demo.cpp / demo.hpp / CMakeLists.txt / Kconfig）、`boards/px4/fmu-v6c/default.px4board`、`ROMFS/.../init.d/rcS`、`PX4ParameterFactMetaData.xml`

**经验**：
- 地面站要显示固件参数，**参数必须真实存在于固件**——网页本地"伪造参数"只是权宜之计，最终必须把功能写进固件再走真实 PARAM 通道；
- `param_control` 模块的边沿检测（`_last_ifsc_dist_sw` 对比）避免启动误报，真实控制器接入时应在此分支挂接控制器实现；
- `.px4` 固件的 JSON 头把 base64 数据内嵌在 `image` 字段（JSON 一直延续到文件末尾），解析时需先 `json.loads` 再取 `image` 解码，而非在 `}` 之后找 base64。

---

## 6. 响应式与可访问性设计

### 6.1 vmin + clamp

所有尺寸单位：

```css
.toolbar { height: 5.5vmin; min-height: 48px; max-height: 64px; }
.toolstrip { width: 7vmin; min-width: 60px; max-width: 80px; }
```

`vmin` 是视口短边的 1%，保证横屏/竖屏下都不会畸形。`min/max` 钳制防极端屏幕。

### 6.2 ResizeObserver

所有 Canvas widget 用 `ResizeObserver` 监听容器尺寸，DPR 适配：

```js
const ro = new ResizeObserver(() => {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
});
ro.observe(container);
```

### 6.3 全局 state 暴露

`window.__qgc_lastTelemetry` 暴露最新 state，外部脚本可以直接读取：

```js
// 第三方页面
setInterval(() => {
  const t = window.__qgc_lastTelemetry;
  if (t) console.log('Yaw:', t.attitude.yaw * 180 / Math.PI);
}, 200);
```

这是**有意为之**的，方便教学演示/嵌入集成。

---

## 7. 调试方法

### 7.1 F12 必看

| 位置 | 看什么 |
|---|---|
| Console | `[MAV] RX frame: ...` 应在连接后每 50ms 一行 |
| Console | `[STATE] HEARTBEAT ...` GCS HB 每秒 1 个 |
| Network → WS | WebSocket 帧数（如果走 WS 路径） |
| Application → Storage | 无（项目无 localStorage） |
| Performance | 60 FPS（仪表盘重绘） |
| Console | `window.__debug()` 查看飞控位置/GPS 实时状态（见 4.2.7） |

### 7.2 关键日志

```js
// 在控制台启用详细日志
localStorage.setItem('qgc-debug', '1');
```

会额外打印：
- 每个 MAVLink 帧的 hex dump
- 每个 FTP 步骤的 req/resp
- 每次 `serialWrite()` 的字节流

### 7.3 串口抓包

Linux：

```bash
# 在网页运行同时另开一个 tty
sudo strace -e write -p $(pgrep -f python) 2>&1 | grep -A1 tty
```

或用 `qgc_test_runner.py` 单独 dump：

```bash
python3 qgc_test_runner.py /dev/ttyACM0
```

### 7.4 与 QGC 对比

最有效的 debug 手段：

1. 同一台电脑，同时跑桌面 QGC 和网页版
2. 对比两者收到的 MAVLink 消息频率、字段值
3. 桌面 QGC 收到但网页没收到 → 90% 是 CRC 错

---

## 8. 未来扩展方向

### 8.1 短期（1-2 周）

- [ ] Mission 编辑器（航点拖拽）
- [ ] 参数编辑器（树状结构 + 搜索）
- [ ] 实时波形图（attitude/altitude/vspeed 多通道）
- [ ] 数据记录到 IndexedDB（替代 ULog 的轻量方案）

### 8.2 中期（1-2 月）

- [ ] WebCodec API 视频流（H.264 解码）
- [ ] 离线地图瓦片（用 mbtiles）
- [ ] 多机协同（多 Web Serial 同时连接）
- [ ] PWA 化（Service Worker + 离线启动）

### 8.3 长期

- [ ] WebTransport 替代 Web Serial（更低延迟）
- [ ] WebGPU 仪表盘（更高帧率）
- [ ] 协议无关的遥测后端（同一套 UI 跑 MAVLink/ROS2/custom）

---

## 附录 A：本地开发流程

```bash
# 1. 一键启动 (推荐): HTTP + WebSocket 桥接 + 自动开浏览器
cd /home/lu/qgc-web
python3 start.py

# 2. 手动启动 HTTP 服务器 (仅调试静态页)
cd /home/lu/qgc-web
python3 -m http.server 8000

# 3. Chrome 打开
#    http://localhost:8000?cache=1234  (cache= 任意数字, 强制刷新)
#    Alt+Shift+R 强制清缓存刷新

# 4. 改代码后, 浏览器刷新即可 (无构建步骤)

# 5. WebSocket 桥接单独运行 (start.py --no-bridge 时)
python3 ws_bridge.py --ws 8766   # 或 python3 ws_bridge.py --help 查看参数
```

## 附录 B：常见开发陷阱

| 陷阱 | 解决 |
|---|---|
| 改 JS 不生效 | URL 加 `?v=` 任意数字 |
| 改 CSS 不生效 | 浏览器 DevTools → Network → Disable cache |
| Web Serial 选不到端口 | Chrome 地址栏 chrome://device-log 看权限 |
| Serial 被 QGC 占 | 关闭 QGC |
| 飞控无响应 | F12 看 GCS HB 是否在发，HEX 是否包含 `fe 09 ... 5a 98` |

## 附录 C：相关源码对照

| 网页端 | QGC C++/QML | 说明 |
|---|---|---|
| `src/mavlink.js` | `src/comm/MAVLinkProtocol.cc` | MAVLink 解析 |
| `src/telemetry.js` (串口部分) | `src/comm/SerialLink.cc` | 串口链路 |
| `src/telemetry.js` (FTP 部分) | `src/Vehicle/FTPManager.cc` | MAVLink FTP |
| `src/views/flyview.js` | `src/FlightDisplay/FlyView.qml` + `FlyViewMap.qml` | Fly 视图 |
| `src/views/logs.js` | `src/AnalyzeView/GeoTagPage.qml` + `LogDownload.qml` | 日志下载 |
| `src/widgets/compass.js` | `src/FlightMap/Widgets/QGCCompassWidget.qml` | 罗盘 |
| `src/widgets/attitude.js` | `src/FlightMap/Widgets/QGCAttitudeWidget.qml` + `QGCArtificialHorizon.qml` | 人工地平仪 |
| `src/widgets/map.js` | `src/QtLocationPlugin/`（瓦片源 + 投影）+ `src/FlightMap/FlightMap.qml` + `MapScale.qml` | 瓦片地图（高德 XYZ + GCJ-02 纠偏） |
| `src/telemetry.js` (位置处理) | `src/Vehicle/Vehicle.cc _handleGlobalPositionInt / _handleHomePosition / _handleAltitude` | 飞控位置/高度/home 读取 |
| `src/telemetry.js` (速度处理) | `src/Vehicle/Vehicle.cc _handleVfrHud` | VFR_HUD 空速/地速/爬升率读取 |
| `ws_bridge.py` | `src/comm/SerialLink.cc`（pyserial 打开方式对齐） | 串口→WebSocket 透传桥（Web Serial 备选） |
| `qrc/resources/FlightMap/*.svg` | `src/FlightMap/Images/*.svg` | 缩放/居中图标 |
| `qrc/resources/toolbar/*.svg` | `src/ui/toolbar/Images/*.svg` | 工具栏图标 |

---

**文档版本**：V1.10（2026-08-07，start.bat 改纯 ASCII 版，修复 Windows Server 2022 GBK 下中文乱码（4.10.1））
**代码版本**：qgc-web V1.1
**作者**：IFSC Station 项目组
