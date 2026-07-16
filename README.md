# IFSC-Station

> 基于 QGroundControl 4.2.8 定制，针对 IFSC（International Fire Service College）无人机科研与训练任务的地面控制站。
> 单 binary AppImage 部署，免安装，可双击运行。

---

## 快速开始

```bash
chmod +x IFSC-Station.AppImage
./IFSC-Station.AppImage
```

详细步骤见 [IFSC_Station_使用手册](IFSC_Station_使用手册.md)。

---

## 文档

| 文档 | 适用对象 | 内容 |
|---|---|---|
| **[IFSC_Station_定制与打包手册](IFSC_Station_定制与打包手册.md)** | 二开工程师 / 打包工程师 | 13 个定制点的源码位置、复现过程中遇到的 8 个问题与解决办法、AppImage 打包脚本差异对照表 |
| **[IFSC_Station_测试手册](IFSC_Station_测试手册.md)** | 测试工程师 / QA | 12 项冒烟测试矩阵、视觉与功能测试清单、跨机器兼容性测试、回归测试脚本 |
| **[IFSC_Station_使用手册](IFSC_Station_使用手册.md)** | 操作员 / 用户 | 快速开始、界面总览、飞控连接、任务规划、遥测日志、FAQ、故障排除 |

---

## 主要定制

- **品牌化**：应用名 `IFSC Station`，版本号 `V1.0`
- **Logo 替换**：工具栏 / AppSettings / 飞行地图朝向 SVG
- **永久 LOGO**：主界面右上角两张 LOGO，与仪表盘等高、随缩放
- **配色统一**：`brandingPurple` 改为深蓝 `#00427F`
- **任务栏 / 文件管理器图标定制**：与官方 QGroundControl 同构方案
- **关闭升级检查**：启动不弹 "New Version Available"
- **AppImage 打包脚本**：与上游 `create_linux_appimage.sh` 等价微调

---

## 仓库结构

```
.
├── IFSC_Station_定制与打包手册.md    # 二开手册
├── IFSC_Station_测试手册.md         # 测试手册
├── IFSC_Station_使用手册.md         # 使用手册
├── deploy/
│   ├── IFSC-Station-start.sh         # AppRun：与 QGC 同构
│   └── create_IFSC-Station_appimage.sh # 打包脚本：6 处品牌名替换
├── resources/
│   ├── IFSC_logo.png                 # 主界面右上角 LOGO
│   ├── LOGO.png                      # 主界面右上角 LOGO
│   ├── QGCLogoBlack.svg              # 替换后
│   ├── QGCLogoFull.svg               # 替换后
│   ├── QGCLogoWhite.svg              # 替换后
│   └── icons/
│       ├── IFSC-Station.png          # 128x128 RGBA（AppImage 应用图标）
│       ├── IFSC-Station.ico          # 10 尺寸 ICO（任务栏 _NET_WM_ICON）
│       ├── IFSC-Station-4262x4262.png # 备份大图（不打包）
│       └── sizes/                    # 多尺寸 PNG 备份
├── src/
│   ├── main.cc                       # setWindowIcon -> IFSC-Station.ico
│   ├── QGCApplication.cc             # applicationName + 关闭版本检查
│   ├── QGCPalette.cc                 # brandingPurple #00427F
│   ├── FlightDisplay/FlyViewWidgetLayer.qml # 右上角 LOGO Row
│   ├── ui/MainRootWindow.qml         # 版本号 label
│   └── ui/preferences/GeneralSettings.qml # 版本号 label
├── qgcresources.qrc                  # 注册新资源
└── ...                                # 其它 QGC 4.2.8 上游文件
```

---

## 复现

```bash
# 1. 克隆
git clone https://github.com/ifsc-gmlab/IFSC_Station.git
cd IFSC_Station

# 2. 按定制与打包手册第 13 节清单修改

# 3. 构建
qmake qgroundcontrol.pro -spec linux-g++ CONFIG+=release
make -j$(nproc) release

# 4. 打包
chmod +x deploy/create_IFSC-Station_appimage.sh
./deploy/create_IFSC-Station_appimage.sh . ./build_<ver>/staging ./output
```

详见 [IFSC_Station_定制与打包手册](IFSC_Station_定制与打包手册.md)。

---

## 许可

源码遵循 [QGroundControl](https://github.com/mavlink/qgroundcontrol) 的 Apache 2.0 许可。
定制部分（`IFSC-Station`）由 IFSC GMLab 维护。

---

## 联系方式

- 仓库：https://github.com/ifsc-gmlab/IFSC_Station
- 主页：https://github.com/ifsc-gmlab
