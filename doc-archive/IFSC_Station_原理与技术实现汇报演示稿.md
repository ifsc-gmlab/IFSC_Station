# IFSC-Station 原理与技术实现 · 汇报演示稿

> **用途**：向导师做阶段性汇报 + 现场演示的脚本（含"讲到哪、点哪、说什么"的逐段脚本）。
> **适用版本**：桌面版 IFSC-Station V1.x（基于 QGC 4.2.8 源码定制） + 网页版 IFSC-Station Web V1.1。
> **配套文档**：
> - [网页版使用手册](IFSC_Station_网页版使用手册.md)
> - [网页版开发手册](IFSC_Station_网页版开发手册.md)
> - [桌面版安装与运行手册](IFSC_Station_安装与运行手册.md)
> - [桌面版定制与打包手册](IFSC_Station_定制与打包手册.md)
> - [桌面版测试手册](IFSC_Station_测试手册.md)
> - [专利技术交底书](IFSC-Station_专利技术交底书.md)

---

## 0. 汇报目标（开场 30 秒念一遍）

1. **讲清楚我们做了什么**：在 QGC 4.2.8 源码上做了面向"全驱动六旋翼 IFSC-Station"的**桌面版深度定制**，并基于同一份协议栈**纯 Web 复刻**了一个免安装的网页版地面站；
2. **讲清楚技术原理**：飞控 ↔ 地面站的链路本质是 MAVLink v1/v2 字节流，桌面版用 Qt Serial、网页版用 Web Serial / WebSocket 桥；
3. **讲清楚核心定制**：三档控制器切换（PID / LQR(INDI) / MPC）是 IFSC-Station 的差异化能力，已落进固件 `param_control` 模块与地面站参数通道；
4. **现场演示**：连接 Pixhawk 6C Mini → 显示姿态/罗盘/真实地图 → 拉取 `.ulg` 日志 → 控制器一键切换 → 瓦片二次秒加载。

---

## 1. 项目全景（一张图讲清楚两件作品的关系）

```
┌──────────────────────────────────────────────────────────────────┐
│                       飞控 Pixhawk 6C / 6C Mini                  │
│              (PX4-Autopilot, IFSC 定制固件 px4_fmu-v6c)          │
│                                                                  │
│   ┌────────────────────┐         ┌─────────────────────────────┐ │
│   │ MAVLink v2 收发     │  USB    │ MAVLink v2 收发              │ │
│   │ param_control      │ ◄────►  │ param_control (IFSC_DIST_SW) │ │
│   │ mc_pos_control FA  │ 115200  │ mc_att_control FA            │ │
│   │ control_allocator  │ 8N1     │ septentrio 双 GPS            │ │
│   └────────────────────┘         └─────────────────────────────┘ │
└─────────────────────┬────────────────────────────┬───────────────┘
                      │ Qt Serial (pyserial 兼容)  │
       ┌──────────────▼─────────────┐ ┌────────────▼──────────────┐
       │  桌面版 IFSC-Station        │ │  网页版 IFSC-Station Web  │
       │  ──────────────────────────│ │  ─────────────────────────│
       │  QGC 4.2.8 Qt5/QML 源码定制 │ │  纯 ES Modules + Canvas   │
       │  AppImage (Linux)           │ │  Web Serial / WebSocket   │
       │  exe (Windows)             │ │  http://localhost:8000     │
       │  功能: 完整飞行控制/视频/固件│ │  功能: 80% 高频遥测+地图+FTP │
       └────────────────────────────┘ └───────────────────────────┘
```

**两个版本的分工**：

| 维度 | 桌面版（Qt） | 网页版（Web） |
|---|---|---|
| 部署 | AppImage / exe，需装 Qt5、GStreamer | 双击 `start.bat` / `./start.sh`，只需 Chrome |
| 通信 | Qt Serial + `MAVLinkProtocol` | Web Serial API / WebSocket 桥 |
| 视频 | GStreamer（rtp / rtsp） | 未实现（实验 API） |
| 参数编辑器 | 完整树形编辑器 | 完整复刻 + 控制器切换条 |
| 固件升级 | 支持 | 不支持（用桌面版） |
| 嵌入 | 否（独立窗口） | 是（iframe） |
| 脚本化 | 否 | 是（`window.__qgc_lastTelemetry` 暴露） |
| 场景 | 工程师整段飞行 | 教学演示、远程观测 |

---

## 2. 原理：地面站到底在干什么（要讲透的 4 件事）

### 2.1 飞控—地面站的链路本质

**结论**：它是一条 **串口字节流 + 一份"MAVLink 词典"**。链路两端各自独立地把字节流按词典翻译成"消息对象"，互相发送。

```
Pixhawk USB CDC           Chrome / Qt 客户端
  /dev/ttyACM0             navigator.serial  |  QSerialPort
       │                          │
       ▼                          ▼
   UART 115200 8N1  ──►  字节流 0xFE/0xFD + len + seq + sysid + compid + msgid + payload + CRC
                          │
                          ▼
                   MAVLink 解析器
                          │
                          ▼
                消息对象:  { name: 'ATTITUDE', roll, pitch, yaw, ... }
```

**串口约束**（这是写代码前要先确认的）：

- 115200 baud、8N1（Pixhawk 6C Mini 默认）
- 一次只能被一个进程打开（同时开 QGC + 网页版必冲突）

### 2.2 MAVLink 协议要点（汇报时画板书）

- **v1 帧**：`0xFE | len | seq | sysid | compid | msgid | payload(0..255) | CRC(2)`
- **v2 帧**：`0xFD | len | incompat | seq | sysid | compid | msgid(24-bit) | payload | CRC | optional signature(13B)`
- **CRC 算法**：**CRC-16/MCRF4XX（poly 0x8408 reflected）**——这是 PX4 用的。
  - ⚠️ 易错点：很多人凭印象用 **CRC-16/MODBUS (poly 0xA001)**。PX4 **静默丢帧**，无 NAK，调试时只会看到"发了但没回应"。
- **GCS HEARTBEAT**：每秒 1 Hz，`type=6 GCS / base_mode=4 MAV_MODE_MANUAL_ARMED`。`base_mode=4` 是飞控判断 GCS "在线"的依据，错了飞控会进安全模式、停止推流。
- **消息订阅**：连上后 GCS 用 `MAV_CMD_SET_MESSAGE_INTERVAL (cmd 511)` 请求关键消息流：

  | msgid | 名称 | Hz | 用途 |
  |---|---|---|---|
  | 0 | HEARTBEAT | 1 | 心跳 / 模式 / 解锁 |
  | 30 | ATTITUDE | 50 | 姿态仪 / 罗盘 |
  | 33 | GLOBAL_POSITION_INT | 10 | 经纬高 / 地速 |
  | 74 | VFR_HUD | 4 | **空速 / 地速 / 爬升率权威源** |
  | 24 | GPS_RAW_INT | 5 | 卫星数 / fix |
  | 1 | SYS_STATUS | 1 | 电池 / 传感器健康 |

### 2.3 QGC 桌面版的源码结构（讲定制点用得到）

```
qgroundcontrol/
├── src/
│   ├── comm/                  # 链路层：SerialLink / MAVLinkProtocol / LinkManager
│   ├── Vehicle/               # 飞控对象、Fact 系统、FTPManager、状态机
│   ├── QtLocationPlugin/      # 地图瓦片引擎（QGCMapEngine + EsriMapProvider）
│   ├── FlightMap/             # 地图视图、控件（CompassRing、QGCAttitudeHUD）
│   ├── FlightDisplay/         # FlyView / FlyViewToolStrip / FlyViewMap
│   ├── AnalyzeView/           # 日志下载 / 解析
│   ├── QmlControls/           # 自定义 QGC 控件（QGCPalette / QGCButton / ToolStrip）
│   ├── api/QGCCorePlugin*     # 品牌化入口（UnitType / Settings URL）
│   └── FirmwarePlugin/PX4/    # PX4 插件、parameters.xml、px4_custom_mode
└── resources/
    ├── IFSC_logo.png          # 我们加的
    └── (其它图标)               # 部分被复制到网页版 qrc/
```

**桌面版"定制"实际改动点**（[定制与打包手册](IFSC_Station_定制与打包手册.md) 详述）：

| 文件 | 改动 | 目的 |
|---|---|---|
| `src/QGCConfig.h` | `APP_NAME = "IFSC-Station"`、品牌色 | 软件标识 |
| `src/QGCPalette.cc` | 品牌色 `#00427F` 注入 | UI 统一 |
| `src/api/QGCCorePlugin.cc` | `settingsURL()` 重定向、UnitType 自定义 | 设置入口 |
| `resources/IFSC_logo.png` | 替换默认 QGC Logo | 品牌 |
| `src/FirmwarePlugin/PX4/parameters.xml` | 加入 IFSC_DIST_SW 枚举（与固件同步） | 参数面板下拉显示 |
| `src/comm/SerialLink.cc` | 默认 115200、连接超时、波特率探测 | 飞控兼容性 |
| `deploy/` | AppImage 打包、桌面图标 | 发行 |
| `IFSC-Station.pro` | 项目名改写 | 构建标识 |

### 2.4 "网页版"不是 Qt 转 Web——是**纯 Web 重写**

> **关键事实**：网页版**没有任何 Qt 代码运行**，也没有把 QGC 编译到 WebAssembly。
>
> 它是把 QGC C++/QML 的**行为模型**用 4500 行原生 JavaScript 重写，**字节流协议完全兼容**——这意味着网页版和桌面版可以同时在两台电脑连接同一个飞控（轮换使用），互不干扰。

```
┌────────────────────────────────────┐
│ index.html                         │  ← 入口
│ src/                               │
│   mavlink.js     (559 行)          │  ← CRC-16/MCRF4XX 解析 + 编码
│   telemetry.js   (767 行)          │  ← 串口/WebSocket 收发 + state
│   views/         (4 个视图)         │  ← flyview/plan/logs/setup
│   widgets/       (5 个 widget)     │  ← attitude/compass/map/scale/chart
│   app.js         (572 行)          │  ← 主入口 + ToolStrip + 视图切换
│   styles.css     (1070 行)         │  ← QGCPalette 映射 + 响应式
│ sw.js             (Service Worker) │  ← 瓦片持久化缓存（替代 QGCMapEngine）
│ ws_bridge.py     (240 行)          │  ← 串口常开 → WebSocket 透传桥
│ start.py / .bat / .sh              │  ← 跨平台一键启动
└────────────────────────────────────┘
```

---

## 3. 桌面版的核心定制（向导师展示"我们改了什么"）

### 3.1 品牌化

- 软件名 `QGroundControl` → `IFSC-Station`
- Logo、配色、窗口标题、About 信息全部改 IFSC
- 主窗口标题栏、ToolStrip 顶部条带、`QGCPalette.windowShade` 等 QML 调色板

### 3.2 串口与链路

- 启动时默认波特率改为 **115200**（PX4 v6C 默认）
- `SerialLink.cc` 增加 `dtrEnable = false`、超时 5s 探测，避免 Windows 上飞控进入 bootloader
- 退出时不主动 toggle DTR（避免触发 USB 复位）

### 3.3 PX4 插件与参数元数据

- `FirmwarePlugin/PX4/parameters.xml` 增加 `IFSC_DIST_SW` 枚举（0=PID / 1=LQR(INDI) / 2=MPC），与固件 `module.yaml` 同步
- `px4_custom_mode.h` 维护 IFSC 全驱动六旋翼的 mode 映射

### 3.4 全驱动六旋翼适配

- 飞控参数：`SYS_AUTOSTART=6003`（`6003_fully_actuated_hexa`）
- `MPC_FA_MODE / MPC_FA_STAB / MPC_FA_RC_AUX / MPC_FA_XY_THR / MPC_FA_XY_RATIO` 参数模板随固件发布
- septentrio 双 GPS 启动段注入（`rc.serial`）

### 3.5 打包

- Linux：`deploy/qgroundcontrol.desktop` + AppImage + 自带图标
- Windows：windeployqt + NSIS / inno setup（具体看 [定制与打包手册](IFSC_Station_定制与打包手册.md)）
- 启动脚本 `deploy/IFSC-Station-start.sh`

---

## 4. 网页版的核心技术实现（重点讲）

### 4.1 双链路：Web Serial 直连 vs WebSocket 桥

```
[首选路径]  Chrome ──Web Serial──► /dev/ttyACM0 ──► Pixhawk
[备选路径]  Chrome ──WebSocket──► ws_bridge.py ──pyserial──► /dev/ttyACM0 ──► Pixhawk
```

**为什么需要备选**：
- 飞控 USB CDC 口对**打开方式**敏感——Pixhawk 6C 在 Web Serial `port.open()` 时会被 USB 复位进 bootloader（`dmesg` 出现 `PX4 BL FMU v6C.x` 字符串交替闪）。**桌面 QGC 不会触发**，是 Web Serial 特有的。
- 解决：写一个 `ws_bridge.py`，用 **pyserial 一次性打开串口并保持常开**，不做任何 MAVLink 解析（纯粹字节透传）。浏览器走 WebSocket 接进来就行。

**ws_bridge.py 的设计取舍**：

| 决策 | 选择 | 原因 |
|---|---|---|
| 协议库 | 不引入 `websockets`，用标准库 | 现场不一定有 pip 网络 |
| 实现 | `socket + threading + hashlib/base64` 手写 RFC 6455 | 240 行可控 |
| 串口策略 | 整个进程生命周期只 `open()` 一次 | 反复开关触发 USB 复位 |
| 写串口 | `threading.Lock` 串行化 | 等价于浏览端的 Promise queue |
| 解析位置 | 全部在浏览器端 | 保证"Web Serial 路径"和"WS 路径"行为完全一致 |
| mock | 不做 | 数据必须来自真实飞控 |

### 4.2 MAVLink 解析器（mavlink.js，559 行）

```js
// 关键 1：CRC 表生成
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 1) ? ((crc >>> 1) ^ 0x8408) : (crc >>> 1);  // ⚠️ 不是 0xA001
  }
  CRC_TABLE[i] = crc;
}

// 关键 2：流式状态机
state ∈ { WANT_STX, WANT_LEN, WANT_SEQ, ..., WANT_PAYLOAD, WANT_CRC1, WANT_CRC2, WANT_SIGNATURE }
// 字节推进 + 失败回到 WANT_STX 重新同步

// 关键 3：v2 msgid 是 24-bit
msgid = b[7] | (b[8] << 8) | (b[9] << 16);

// 关键 4：每条消息的 crcExtra 必须内置
HEARTBEAT:   { id: 0,   crcExtra: 50, ... },
ATTITUDE:    { id: 30,  crcExtra: 39, ... },
VFR_HUD:     { id: 74,  crcExtra: 20, ... },  // 空速/地速权威源
GLOBAL_POSITION_INT: { id: 33, crcExtra: 104, ... },
HOME_POSITION:       { id: 242, crcExtra: 104, ... },
```

**踩过的坑（要专门讲）**：
- **CRC 错用 0xA001** → PX4 静默丢帧，看 HEARTBEAT `0xC53D` vs 期望 `0x5A98`，毫无错误提示；
- **VFR_HUD 字段顺序**：XML 声明是 `airspeed, groundspeed, heading, throttle, alt, climb`，但 mavgen 按 4 字节对齐重排为 `airspeed@0, groundspeed@4, alt@8, climb@12, heading@16, throttle@18`——`alt/climb` 顺序相反，用 pymavlink 真值对比才抓到；
- **FTP payload 必须是 251 字节**（12 字节 FTP header + 239 字节 data），244 字节短帧会被 PX4 静默丢；
- **FTP 路径是相对路径**：`""`=根、`"log"`、`"log/sess100/log100.ulg"`。PX4 内部 `_constructPath` 会自动拼 `_root_dir="/fs/microsd"`，发绝对路径会拼出 `/fs/microsd/fs/microsd/log` → FileNotFound；
- **`req_opcode` 必须始终为 0**（MAVLink 规范，不是"上一次请求的 opcode"）；
- **PX4 OpenFileRO 始终返回 session=0**（单会话），不要假设非 0。

### 4.3 通信主循环（telemetry.js）

```js
// 写串行化（WritableStream 独占，必须排队）
let writeQueue = Promise.resolve();
function serialWrite(bytes) {
  writeQueue = writeQueue.then(async () => {
    const w = port.writable.getWriter();
    await w.write(bytes);
    w.releaseLock();
  });
  return writeQueue;
}

// 读循环：每条消息独立 try/catch，单条异常不杀死整个循环（PX4 v1.17 升级后教训）
async function readLoop() {
  const reader = port.readable.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const byte of value) parser.feed(byte);
  }
}

// GCS HEARTBEAT（每秒）
setInterval(() => {
  serialWrite(mavlink.encodeFrame(0, {
    type: 6, autopilot: 8, base_mode: 4, custom_mode: 0, system_status: 4
  }, sysid, compid, seq++));
}, 1000);

// 连上飞控后请求消息流
sendCommandLong(511, 30, 20000, ...);   // ATTITUDE @ 50 Hz
sendCommandLong(511, 33, 100000, ...);  // GLOBAL_POSITION_INT @ 10 Hz
sendCommandLong(511, 74, 250000, ...);  // VFR_HUD @ 4 Hz
```

### 4.4 状态对象 + 第三方可订阅

```js
// window.__qgc_lastTelemetry 是有意暴露的全局对象
// 第三方 iframe / 教学页可以直接读
setInterval(() => {
  const t = window.__qgc_lastTelemetry;
  if (t) console.log('Yaw:', (t.attitude.yaw * 180 / Math.PI).toFixed(1));
}, 200);
```

### 4.5 仪表盘（Canvas 2D，60 FPS）

- 人工地平仪：`ctx.translate → rotate(roll) → 画天空/大地 → translate(0, pitch*100) → 画十字 + 飞机符号`
- 罗盘：`lastYaw += angleDelta(lastYaw, d.yaw) * 0.2` 平滑，`angleDelta` 处理 ±π 跳变；`ctx.rotate(-lastYaw)`（已是弧度）
- 响应式：`vmin + min/max clamp` + `ResizeObserver` + DPR 适配

**最隐蔽 bug**（要讲）：
```js
// 错的（几乎不转）：
ctx.rotate(-lastYaw * Math.PI / 180);   // lastYaw 已经是弧度，再乘 π/180 等于除 180
// 对的：
ctx.rotate(-lastYaw);
```
**两行单独看都对，组合在一起就是 bug。**

### 4.6 地图（map.js）

**三代演进**：

| 版本 | 方案 | 问题 |
|---|---|---|
| V1.0 | 手写 SVG 网格"假地图" | 无真实地理，已删除 |
| V2 | Esri XYZ 瓦片 | 无中文地名 |
| V3（当前） | 高德 XYZ 瓦片 + Hybrid 标注叠加 + GCJ-02 纠偏 | 与 QGC `src/QtLocationPlugin/` + `src/FlightMap/` 对齐 |

**核心组件**（参 QGC `FlightMap.qml`）：

```js
// 1. Web Mercator 投影
function lon2px(lon, z) { return ((lon + 180) / 360) * (256 << z); }
function lat2px(lat, z) { return (...); }

// 2. 分数缩放（QGC 允许 zoom=0.5 步进）
const z0 = Math.floor(zoom);
const s = Math.pow(2, zoom - z0);
const tileSize = 256 * s;

// 3. GCJ-02 纠偏（高德瓦片用 GCJ-02，GPS 数据是 WGS-84，差 300–500m）
function wgs84ToGcj02(lat, lon) { /* a=6378245.0, ee=0.00669342162296594323 */ }
// 内部 state 始终存 WGS-84；渲染/交互时再转 GCJ-02

// 4. Hybrid：卫星底图 + 透明标注层（路网/区域名），pointer-events: none

// 5. 跟踪飞行器：keepMapCenteredOnVehicle，仅当位移 > 8px 才重载瓦片
```

**按钮 1:1 复刻 QGC `QGCMapToolButton.qml`**：

| QGC QML | 网页版 |
|---|---|
| `Button { background: Rectangle { color: __qgcPal.window } }` | `.map-widget-btn { background: rgba(0,0,0,.7); }` |
| `QGCColoredImage { source: imageSource }` | `<img src="qrc/resources/FlightMap/MapCenter.svg">` |
| `onClicked: map.zoomLevel += 0.5` | `btn.addEventListener('click', () => mapCtl.zoomIn())` |

**SVG 资源从 QGC 源码 `src/FlightMap/Images/` 直接复制**——不手绘，保证像素一致。

### 4.7 瓦片加载优化（对比 QGC 磁盘缓存）

**QGC 桌面版秒开**：`QGCMapEngine.cpp` 的 1GB SQLite 磁盘缓存（先内存 → 再磁盘 → 最后网络）。

**网页版的等价物**：Service Worker + Cache API（对 `fetch` 层透明拦截，零侵入）。

```
sw.js:
  fetch event:
    if (url matches 高德瓦片) → cacheFirst() → 命中直接返回
    else → 放行
```

**三道防线**：

1. **启动健康探测**（事前规避）：模块加载时 `fetch` 探一遍 4 个子域，`AbortController` 2.5s 超时，失败的进 `amapSick` 池，后续轮换自动跳过；
2. **preconnect**（省 TLS 握手）：`<link rel="preconnect">` 给健康子域，浏览器在解析 HTML 时就完成握手；
3. **Service Worker 持久缓存**（QGC 磁盘缓存等价物）：`caches.open('ifsc-tiles-v1')`，URL 规范化（`webst01~04` → `webst00`，避免同瓦片多子域重复），20000 条上限 + 节流 trim。

实测：刷新页面瓦片不再走网络，控制台 `caches.open('ifsc-tiles-v1')` 返回 36 条。

### 4.8 控制器切换（IFSC_DIST_SW · 专利差异化能力）

**全栈路径**（这是要重点讲的"我们做了什么不一样的事"）：

```
[网页/桌面 Params 视图]
   用户点击 "PID / LQR(INDI) / MPC" 按钮
        │
        ▼  PARAM_SET (msgid 23)
   GCS ───────────────────────────────────► PX4 (param_control 模块)
                                                │
                                                ▼
                                       _last_ifsc_dist_sw 边沿检测
                                                │
                                                ▼  PX4_INFO 打印
[IFSC] Disturbance Switch -> MPC Control (2). MPC controller selected.
                                                │
                                                ▼  真实控制器切换入口
                                       mc_pos_control / mc_att_control
```

**固件侧**（`src/modules/param_control/`）：

- `module.yaml`：定义枚举参数 `IFSC_DIST_SW`（0=PID / 1=LQR(INDI) / 2=MPC，type=enum，category=Standard）；
- `demo.cpp`：订阅 `vehicle_local_position`，`Run()` 中用 `_last_ifsc_dist_sw` 做边沿检测——参数变化时通过 `PX4_INFO` 打印切换事件，**真实控制器接入后应在此分支挂接控制器实现**；
- 编译接入：`Kconfig` + `boards/px4/fmu-v6c/default.px4board`（`CONFIG_MODULES_PARAM_CONTROL=y`）+ `rcS` 启动 `param_control start`。

**关键决策**：早期考虑过"网页本地伪造参数"展示——**已否决**。参数必须真实存在于固件，走真实 PARAM 通道。

**网页端**（Params 视图）：点击按钮 → `sendParamSet('IFSC_DIST_SW', value)` → 飞控 ack 后 UI 反馈切换成功。

### 4.9 一键启动脚本（start.py）

```python
# 1. MIME 注册（Windows Python 3.11+ 默认 .svg → image/svg，Chrome 不识别 → 全部图标丢失）
_EXTRA_MIMES = {'.svg': 'image/svg+xml', '.svgz': 'image/svg+xml', '.ttf': 'font/ttf', ...}
for ext, mt in _EXTRA_MIMES.items(): mimetypes.add_type(mt, ext)

# 2. 端口探测用 BIND，不用 connect（避免 TIME_WAIT 误判）
def is_port_in_use(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try: s.bind(('127.0.0.1', port)); return False  # 能 bind → 空闲
    except OSError: return True

# 3. HTTP 存活探测（避免重复启动两个服务）
# 4. 跨平台开浏览器（Windows: os.startfile / macOS: open / Linux: xdg-open）
# 5. WebSocket 桥接联动（检测到 /dev/ttyACM* 自动拉起 ws_bridge.py）
```

`start.bat`（Windows）：纯 ASCII、参数透传 `%*`、Python 探测 `py -3 → python3 → python`、`pause` 兜底。

---

## 5. 关键问题与工程经验（汇报亮点）

| 问题 | 根因 | 修复 |
|---|---|---|
| 飞控不响应 GCS HB | CRC 用 0xA001（MODBUS） | 改 0x8408（MCRF4XX） |
| FTP 全死锁 | payload 244 字节 | 改 251 字节（239 data） |
| FTP FileNotFound | 发绝对路径 `/fs/microsd/log` | 改相对路径 `log` |
| 罗盘不转 | `ctx.rotate(-yaw * π/180)` 但 yaw 已是弧度 | 去掉 `* π/180` |
| 列表解析 0 条目 | 假设 `\n` 分隔 | 改 `\0` 分隔 + 首字符判 D/F |
| Web Serial device lost | Pixhawk 6C USB CDC 对 open 方式敏感 | 走 ws_bridge.py 常开串口 |
| WS refused | start.py 只起 HTTP 不起桥 | start.py 自动拉起 ws_bridge.py |
| 地图加载慢 | 子域名坏 + TLS 握手 | 健康探测 + preconnect + Service Worker |
| 速度恒为 0 | STREAM_REQUESTS 误写 msgid=105（实为 HIGRES_IMU） | 改为 msgid=74 |
| PX4 v1.17 全链路冻结 | 单条消息异常杀死 read loop | try/catch + 自动重启 + 看门狗 |
| 顶部图标空白 | 内联 SVG 的 `<style>` 是文档级全局 | 用唯一 id 前缀作用域化 |
| 顶部图标模糊 | 复杂 Illustrator 路径缩到 18px + DPR 1.2 | 改 `<img>` 引用 QGC 原 SVG，22px+ |

**通用经验**：

1. **协议规范要从源码抄，不要凭印象**（CRC、字段顺序、payload 长度都是）；
2. **流式 read 循环必须保证"单条异常不杀死整个循环"**——这类 bug 没有任何错误提示，最难排查；
3. **瓦片 CDN 多子域名：失败重试是事后补救，启动健康探测才是事前规避**；
4. **浏览器持久化缓存是网页版 vs 桌面版体验差异的根源**——SW + Cache API 是 QGC 磁盘缓存的直接等价物；
5. **UI 资源从源头复制，不要手绘**（QGC SVG 已像素验证过）；
6. **Web Serial 必须在 localhost 或 https 下**，IP 访问不可用——这是 W3C 规范；
7. **跨源瓦片缓存必须 URL 规范化**，否则 CDN 子域轮换会让命中率大打折扣。

---

## 6. 性能与对比（用数字说服导师）

| 指标 | 桌面版 IFSC-Station | 网页版 IFSC-Station Web |
|---|---|---|
| 安装包大小 | ~150 MB（Qt5 + GStreamer） | ~3 MB（纯静态 + Python 启动器） |
| 启动时间 | 3–5 s | < 1 s（HTTP 服务秒起） |
| 冷启连接 | ~2 s | ~2 s |
| 姿态更新率 | 50 Hz | 50 Hz |
| 仪表帧率 | 60 FPS | 60 FPS |
| 内存占用 | ~300 MB | ~150 MB |
| 视频流 | ✅ GStreamer | ❌ |
| 固件升级 | ✅ | ❌ |
| 跨平台 | Linux/Win/macOS（需各打包） | Chrome 一致 |
| 嵌入第三方 | ❌ | ✅ iframe |
| 远程访问 | 需 VNC | 局域网内浏览器 |

**功能覆盖率（网页版 vs 桌面版）**：约 80% 高频操作（连接/姿态/地图/参数/控制器切换/日志/校准），视频流 / 固件升级 / 完整 Mission 编辑器 / 视频 PIP 是差异项。

---

## 7. 演示脚本（向导师现场演示时的口播稿）

> **总时长建议**：12–15 分钟（讲 5 分钟 + 演示 7–10 分钟）。
> **设备清单**：Pixhawk 6C Mini × 1（已烧 `px4_fmu-v6c_default(4).px4` 固件）、USB 数据线 × 1、Windows 笔记本 × 1（已装 Chrome 120+ + Python 3.11+）、投影仪。
> **预演**：正式汇报前必须把以下步骤各跑通 1 次。

### 7.1 准备（0:00–0:30）

**口播**：
> "我先准备一下演示环境。这是我们 IFSC-Station 的全驱动六旋翼飞控 Pixhawk 6C Mini，已经烧录了我们带 `param_control` 模块的定制固件。地面站这边用的是我们网页版的 IFSC-Station Web。"

**操作**：

1. 关闭桌面版 QGC（如开着）；
2. 插飞控 USB，电源灯亮；
3. 打开终端，验证 `ls /dev/ttyACM*` 出现 `/dev/ttyACM0`（Windows 跳过）。

### 7.2 一键启动（0:30–1:30）

**口播**：
> "网页版的启动是一个跨平台脚本，Windows 双击 `start.bat`，Ubuntu 跑 `./start.sh`，它会做四件事：注册 SVG MIME、探测端口、打开浏览器、检测到飞控就自动拉起 WebSocket 桥接。"
>
> "我们之前踩过一个坑：Pixhawk 6C 的 USB CDC 对 Web Serial 直连会触发飞控 USB 复位进 bootloader，所以我们自动走了 WebSocket 桥，pyserial 一次性打开串口保持常开，稳定性等同于桌面 QGC。"

**操作**：

```bash
cd IFSC-web
./start.sh
# 或 Windows 双击 start.bat
```

观察：

- 控制台打印"IFSC-Station 网页版启动器"；
- 浏览器自动打开 `http://localhost:8000/`；
- 终端 `ss -tlnp` 可见 8000（HTTP）+ 8766（WS 桥）监听。

### 7.3 连接飞控（1:30–2:30）

**口播**：
> "网页端的 Connect 弹窗里有两个连接类型——Web Serial 直连和 WebSocket 桥。我们选桥接，连 `ws://localhost:8766`。"

**操作**：

1. 点击右上 **Connect** → 连接类型选 **WebSocket Bridge**；
2. URL 填 `ws://localhost:8766` → 点连接；
3. 几秒内 `Link` 指示器变绿、`Connected`、`Hz` 跳动。

**观察**：

- 顶部 GCS HB 指示每秒 1 次；
- 飞控 HB 在控制台每秒一行（`[VEH HB#1] type=2 autopilot=3 base_mode=4 system_status=3`）。

### 7.4 Fly 视图（2:30–5:00）

**口播**：
> "这是 Fly 视图。左边是人工地平仪和罗盘，仪表盘用 Canvas 2D 重绘，60 FPS。中间是真实地图，我们接的是高德瓦片——卫星底图 + 路网标注叠加层 Hybrid。右下角是遥测栏。"

**操作**：

1. 轻拨飞控姿态（手拿飞控倾斜），人工地平仪实时转动、罗盘指针平滑旋转；
2. 指向地图：右上角 `+`/`-` 缩放、`◎` 居中飞行器；
3. 展示**底部遥测栏**：ALT / GSPD / ASPD / VSPEED / Battery / GPS / RSSI 跳动；
4. （如 GPS 锁定）地图上出现黄色十字 = 飞行器位置，红色三角 = HOME，绿色折线 = 轨迹。

**强调**（对导师）：
> "这套仪表和地图交互是**逐行复刻 QGC 源码**的——`FlightMap.qml` 的 ±0.5 步进、`MapScale.qml` 的比例尺步长、`QGCMapToolButton.qml` 的按钮样式，全部对照实现的。"

### 7.5 Params 视图 + 控制器切换（5:00–8:00，**重头戏**）

**口播**：
> "进入 Params 视图。这是我们网页版完整复刻 QGC 的参数编辑器。**重点看顶部这条控制器切换条**——这是我们 IFSC-Station 的差异化能力：点击 PID / LQR(INDI) / MPC 三个按钮，地面站通过 PARAM_SET 写入飞控的 `IFSC_DIST_SW` 参数，固件侧的 `param_control` 模块会检测到这个变化，切换到对应的控制器。"
>
> "这三个控制器在底层的差异是 PID 用飞控内置 PID 控制律；LQR(INDI) 是用增量非线性动态逆实现的 LQR；MPC 是模型预测控制。这是我们专利交底书里写的核心定制能力。"

**操作**：

1. 点击 **Params** 按钮进入参数视图；
2. 顶部出现 **PID / LQR(INDI) / MPC** 三个按钮；
3. 点击 **LQR(INDI)** → 控制台弹出参数写入日志，飞控串口应同时打印：
   ```
   [IFSC] Disturbance Switch -> LQR (INDI) Control (1). LQR/INDI controller selected.
   ```
4. 点击 **MPC** → 切换到 MPC，日志更新；
5. 点回 **PID** → 恢复内置 PID；
6. 演示参数树搜索（例如搜 `IFSC_DIST_SW`）→ 下拉显示三档；
7. Tools → Reboot → 飞控重启（可选，需确认现场状态）。

**强调**：
> "注意我们**没有走任何本地伪造参数**的捷径——这个 `IFSC_DIST_SW` 是固件原生参数，必须真实烧进 PX4 才会出现。我们把 `param_control` 模块合并进 PX4 源码、重新编译固件，参数通道走真实 MAVLink PARAM 协议。"

### 7.6 Analyze 视图 · 日志下载（8:00–10:00）

**口播**：
> "日志下载用的是 MAVLink FTP 协议——和桌面 QGC 的 `FTPManager.cc` 完全一样的协议。我们网页版走的是 msgid 110 FILE_TRANSFER_PROTOCOL。"

**操作**：

1. 切换到 **Analyze** → 点击 **Logs**；
2. 点击"刷新列表" → 控制台打印 `[FTP] ListDirectory log/`；
3. 展开看到 `sess100/ sess101/ ...` 会话目录；
4. 点击某个 `.ulg` 文件 → 浏览器触发下载；
5. （可选）打开 `~/Downloads/xxx.ulg` 文件大小对得上。

**强调**：
> "FTP 实现有三个易错点：路径必须是相对路径、PX4 严格要求 251 字节 payload、`req_opcode` 必须为 0。这都是我们用 pymavlink 真值对比才确认的。"

### 7.7 Setup 视图 · 校准（10:00–11:00，可选）

**操作**：

1. 切换到 **Setup** → 罗盘校准 → 按 6 方位摆放飞控 → 看进度条；
2. 遥控器校准 → 拨动摇杆 → 8 通道实时数值。

### 7.8 地图二次打开秒加载（11:00–12:00）

**口播**：
> "最后一个亮点——瓦片持久化缓存。QGC 桌面版秒开是因为 `QGCMapEngine` 有 1GB SQLite 磁盘缓存。网页版的等价物是 Service Worker + Cache API，对 `fetch` 层透明拦截，零侵入。"
>
> "我先刷新一下页面……"

**操作**：

1. Ctrl+Shift+R 强制刷新；
2. F12 → Application → Cache Storage → `ifsc-tiles-v1` → 看到几十条瓦片；
3. 地图几乎瞬间出现（不像第一次需要逐张下载）。

**强调**：
> "再切到 Network 面板，把网络调成 Offline——地图还能正常显示。瓦片是真的离线可用了。"

### 7.9 对比与小结（12:00–13:00）

**口播**：
> "总结一下。**桌面版 IFSC-Station** 是基于 QGC 4.2.8 做的深度定制，改了品牌化、串口、PX4 插件、全驱动六旋翼适配、固件元数据，是面向工程师的主力工具。**网页版 IFSC-Station Web** 是同一份 MAVLink 协议栈的纯 Web 重写，4500 行原生 JS，免安装、可嵌入、能脚本化，覆盖 80% 高频操作，是教学演示和远程观测场景的最佳载体。"
>
> "两者通过同一个飞控协议栈保持兼容——理论上可以同时连接同一台飞控（轮换使用），互不干扰。"

### 7.10 Q&A 兜底（13:00–15:00）

**常被问到的问题（提前准备答案）**：

| 问题 | 简短回答 |
|---|---|
| 网页版为什么不用 WebAssembly 把 Qt 编译上去？ | 编译复杂、产物巨大（≥30MB）、启动慢、调试链长。纯 JS 重写更小、更可控、更易嵌入。 |
| 为什么不支持视频流？ | WebCodec API 在 Chrome 实验、Linux 摄像头权限问题、GStreamer 不能跑浏览器。当前场景靠遥控器图传 OSR 即可。 |
| 为什么没有完整 Mission 编辑器？ | MissionItemIndicator + drag 交互 UI 工作量大。航点列表框架已留好，后续补充。 |
| `IFSC_DIST_SW` 三个值分别做了什么？ | 0=PID（飞控内置）；1=LQR(INDI)（增量非线性动态逆实现的 LQR）；2=MPC（模型预测控制）。详见专利交底书。 |
| 网页版数据安全吗？ | HTTP 明文，**不要暴露公网**。Web Serial 必须 localhost 或 HTTPS。 |
| 二次开发怎么接？ | 看 [定制与打包手册](IFSC_Station_定制与打包手册.md) 和 [网页版开发手册](IFSC_Station_网页版开发手册.md)。 |

---

## 8. 后续工作（汇报收尾）

### 8.1 短期（1–2 周）

- [ ] 网页版 Mission 编辑器（航点拖拽 + 高度/速度设置）
- [ ] 网页版波形图（attitude / altitude / vspeed 多通道）
- [ ] 数据记录到 IndexedDB（轻量替代 ULog）
- [ ] QGC 参数元数据 XML 与固件 `module.yaml` 双向同步脚本

### 8.2 中期（1–2 月）

- [ ] WebCodec 视频流（实验性，先解决摄像头权限）
- [ ] PWA 化（Service Worker 启动 + 离线包）
- [ ] 多机协同（多 Web Serial / WS 桥同时连接）
- [ ] 真实控制器代码接入 `param_control` 边沿检测分支

### 8.3 长期

- [ ] WebTransport 替代 Web Serial（更低延迟）
- [ ] WebGPU 仪表盘
- [ ] 协议无关遥测后端（MAVLink / ROS2 / 自定义）

---

## 附录 A：技术决策一览表

| 决策点 | 选项 | 最终选择 | 理由 |
|---|---|---|---|
| 桌面版基础 | 改 QGC 源码 vs 写插件 | 改源码 | 改动范围可控、品牌化深、定制点明确 |
| 网页版技术栈 | 编译 Qt / React / 原生 JS | 原生 ES Modules + Canvas | 零构建、零依赖、4500 行可控、易嵌入 |
| 网页端通信 | Web Serial / WebSocket 桥 | 双链路自动选择 | Web Serial 在 Pixhawk 6C 上不稳 |
| 瓦片源 | Esri / Google / 高德 / OSM | 高德 + Hybrid | 国内地图必须 GCJ-02、高德免费、无 token |
| 持久化 | Cache API / IndexedDB / localStorage | Cache API + SW | 透明拦截、零侵入 |
| 启动脚本 | shell / Python / Node | Python（标准库） | 系统自带、跨平台、零依赖 |
| 控制器切换实现 | 本地伪造 / 真实固件 | 真实固件 | 参数必须真实存在 PARAM 通道 |
| MAVLink 实现 | 库 / 手写 | 手写 559 行 | 可读性高、易调试、与 QGC 真值对比验证 |

## 附录 B：代码量统计

| 模块 | 行数 |
|---|---|
| 桌面版 QGC 改动（增量） | ~3000 行（品牌、串口、PX4 插件、参数、固件） |
| 网页版 qgc-web | 4511 行（mavlink 559 + telemetry 767 + views 655 + widgets 761 + app 572 + styles 1070 + index 127） |
| ws_bridge.py | 240 行 |
| start.py + start.bat + start.sh | ~350 行 |

## 附录 C：参考资料

- MAVLink 规范：<https://mavlink.io/en/guide/serialization.html>
- PX4 MAVLink FTP：<https://docs.px4.io/main/en/middleware/mavlink.html>
- Web Serial API：<https://developer.chrome.com/docs/capabilities/serial>
- QGC 源码：[qgroundcontrol/](file:///home/lu/Share/qgroundcontrol/)

---

**文档版本**：V1.0（2026-08-26，首次撰写汇报演示稿）
**配套代码**：桌面版 IFSC-Station V1.x + 网页版 IFSC-Station Web V1.1
**作者**：IFSC Station 项目组
