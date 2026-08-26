# IFSC-Station 定制与打包完整手册

> 适用源码版本：**QGroundControl 4.2.8**（`GIT_DESCRIBE = v4.2.8`）。
> 适用构建系统：**qmake + Qt 5.15.3**（Linux release 构建）。
> 项目根目录以下用 `.` 表示，所有相对路径均从仓库根目录出发。
> 本手册可在**完全干净**的 QGC 4.2.8 源码上直接按步骤复现整套定制。

---

## 0. 目录

1. 顶部窗口标题从 `QGroundControl Daily` 改为 `IFSC Station`
2. 主窗口 / 设置面板里 "Version" 字样与版本号替换为 `IFSC Station` / `V1.0` 并居中
3. 关闭 `New Version Available` 升级弹窗
4. 替换工具栏左上角 / AppSettings 顶栏 / 飞行地图朝向 logo（直接覆盖 SVG）
5. 主界面飞行视图右上角永久显示两个自定义 LOGO（`LOGO.png` + `IFSC_logo.png`）
6. 把 `brandingPurple` 调色板改成深蓝 `#00427F`，让顶部工具栏主题配色统一
7. 任务栏 / 启动器图标修复（AppImage 重新打包后的跨机器显示）
8. AppImage 打包脚本 `create_IFSC-Station_appimage.sh` 使用说明
   - 8.5 `create_IFSC-Station_appimage.sh` 从 `create_linux_appimage.sh` 修改对照表
9. 关于 `custom-example/` 的取舍说明
10. 整套改动文件清单

---

## 1. 顶部窗口标题：`QGroundControl Daily` → `IFSC Station`

**涉及文件**：[src/QGCApplication.cc](src/QGCApplication.cc)

修改 `QGCApplication::_initCommon()` 中 `applicationName` 的赋值（4.2.8 行号约 267）：

```cpp
// 修改前
applicationName = QStringLiteral("%1 Daily").arg(QGC_APPLICATION_NAME);

// 修改后
applicationName = QStringLiteral("IFSC Station");
```

> 说明：`QGC_APPLICATION_NAME` 在 `src/QGCApplication.cc` 顶部默认为 `"QGroundControl"`；直接写死 `IFSC Station` 可避免 Daily 后缀与原名叠加。
> 该名称同时影响操作系统任务栏 / 标题栏名称，以及内部 `QGCApplication.appName`（被 QML 多处使用）。

---

## 2. 主窗口 / 设置面板中版本号替换并居中

### 2.1 主窗口底部

**涉及文件**：[src/ui/MainRootWindow.qml](src/ui/MainRootWindow.qml)

定位 `selectToolDialog` 内部两个 `QGCLabel`（约 423 / 433 行）：

```qml
// 修改前
QGCLabel {
    id:                     versionLabel
    text:                   qsTr("%1 Version").arg(QGroundControl.appName)
}
QGCLabel {
    text:                   QGroundControl.qgcVersion        // 例如 v4.2.8
}

// 修改后
QGCLabel {
    id:                     versionLabel
    text:                   qsTr("IFSC Station")             // 去掉 "Version" 后缀
    Layout.fillWidth:       true                              // 撑满布局宽度
    horizontalAlignment:    Text.AlignHCenter                 // 内部水平居中
}
QGCLabel {
    text:                   "V1.0"                            // 替换原 v4.2.8
    Layout.fillWidth:       true
    horizontalAlignment:    Text.AlignHCenter
}
```

`QGCMouseArea`（彩蛋点击区）保留不动（`anchors.fill: parent` 仍覆盖整个版本区域）。

### 2.2 Application Settings 面板

**涉及文件**：[src/ui/preferences/GeneralSettings.qml](src/ui/preferences/GeneralSettings.qml)

定位同位置两个 `QGCLabel`（约 1119 行紧接其后的区域）：

```qml
// 修改前
QGCLabel { text: qsTr("%1 Version").arg(QGroundControl.appName) }
QGCLabel { text: QGroundControl.qgcVersion }

// 修改后
QGCLabel { text: qsTr("IFSC Station"); Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter }
QGCLabel { text: "V1.0";               Layout.fillWidth: true; horizontalAlignment: Text.AlignHCenter }
```

---

## 3. 关闭 `New Version Available` 弹窗

**涉及文件**：[src/QGCApplication.cc](src/QGCApplication.cc)

定位版本检查代码块（位于 `QGCApplication::_checkForNewVersion` / `_versionCheckDone` 调用附近）。将原本在收到远端 release JSON 后弹窗的整段逻辑用 `if (false)` 包住，或直接注释掉 `_versionCheckDone` 调用：

```cpp
// 修改前：原本会调用 _versionCheckDone(releaseJson) 然后弹窗
// 修改后：用 if(false) 包裹，使其在启动时不再触发升级提示
if (false) {
    // 原 releaseJson / version 比较 / _versionCheckDone(...) 代码保留不动
}
```

效果：启动时不再弹出 "You can download it from qgroundcontrol.com"。

---

## 4. 替换工具栏 / AppSettings / 飞行地图朝向 logo

| 引用点 | 资源路径 | 源文件 | 显示位置 |
|---|---|---|---|
| [MainToolBar.qml:70](src/ui/toolbar/MainToolBar.qml#L70) | `/res/QGCLogoFull` | [resources/QGCLogoFull.svg](resources/QGCLogoFull.svg) | 主工具栏左上角 logo |
| [MainRootWindow.qml](src/ui/MainRootWindow.qml) 内 AppSettings 调用 | `/res/QGCLogoWhite` | [resources/QGCLogoWhite.svg](resources/QGCLogoWhite.svg) | AppSettings 顶部小标题栏 logo |
| [FlightMap.qml:129](src/FlightMap/FlightMap.qml#L129) | `/res/QGCLogoFull` / `QGCLogoArrow` | [resources/QGCLogoFull.svg](resources/QGCLogoFull.svg) | 飞行地图中心朝向图标 |

> 三个 logo 都在同一个 `qgcresources.qrc` 中以 alias 注册（详见第 10 节），直接替换源 `.svg` 即可。

### 修改步骤

#### 步骤 1：替换源 SVG

```bash
cp /path/to/your/icon_full.svg  resources/QGCLogoFull.svg
cp /path/to/your/icon_white.svg resources/QGCLogoWhite.svg
cp /path/to/your/icon_black.svg resources/QGCLogoBlack.svg
```

建议尺寸保持与原文件一致；白色透明背景适配深色工具栏。

#### 步骤 2：触发 Qt 资源系统重新编译（**关键**）

Qt 资源 `.qrc` 将 SVG 嵌入二进制，`make` 不监听 `.svg` 的 mtime 变化，单纯替换后 `make` 不会重新生成资源：

```bash
cd build_v428

# 触发 qrc 重新生成
touch qgcresources.qrc
touch qgroundcontrol.qrc

# 删除已编译的 qrc 对象
rm -f qrc_qgcresources.o
```

#### 步骤 3：重新编译

```bash
make -j4
```

#### 步骤 4：验证新图标已嵌入

```bash
python3 -c "
data=open('staging/QGroundControl','rb').read()
needle=open('resources/QGCLogoWhite.svg','rb').read()
print('QGCLogoWhite in binary:', needle in data)
"
```

返回 `True` 表示成功嵌入。

---

## 5. 主界面飞行视图右上角永久显示两个 LOGO

**涉及文件**：[src/FlightDisplay/FlyViewWidgetLayer.qml](src/FlightDisplay/FlyViewWidgetLayer.qml)

### 5.1 把 PNG 注册进 Qt 资源系统

**涉及文件**：[qgcresources.qrc](qgcresources.qrc)

找到 `<qresource prefix="/res">` 块（末尾几个 `</qresource>` 之前的最后一段，约 57 行后），在已存在的 `</qresource>` 之前加两行：

```xml
<file alias="LOGO.png">resources/LOGO.png</file>
<file alias="IFSC_logo.png">resources/IFSC_logo.png</file>
```

放置 PNG 实体：

```bash
cp /path/to/LOGO.png      resources/LOGO.png
cp /path/to/IFSC_logo.png resources/IFSC_logo.png
```

> **关于此前出现的一次 `RCC Parse Error`**：必须把 `<file>` 写在 `<qresource>` 标签**内部**；曾误写在 `</RCC>` 外侧，导致 rcc 报 `Line 107 Column 31 [unexpected <FILE> tag]`。修复即把行挪到正确的 `<qresource>` 块内即可。

### 5.2 修改 FlyViewWidgetLayer.qml

把现有 `Image { source: "file:///..." }` 改为 qrc 引用（4.2.8 行号 291 / 303）：

```qml
// 修改前（绝对文件路径——换机器/换目录后失效，且不会被编进二进制）
source: "file:///home/lu/qgroundcontrol/build_v428/staging/IFSC_logo.png"
source: "file:///home/lu/qgroundcontrol/build_v428/staging/LOGO.png"

// 修改后（编译进二进制，AppImage 内任何机器都能找到）
source: "qrc:/res/IFSC_logo.png"
source: "qrc:/res/LOGO.png"
```

> 注意：必须改成 `qrc:/...` 协议路径，否则 PNG 不会被 `make` 处理，AppImage 打包后图标丢失。

### 5.3 强制重新编译（关键）

```bash
cd build_v428
touch ../qgcresources.qrc
rm -f qrc_qgcresources.o
make -j4
```

### 5.4 验证 PNG 已嵌入

```bash
cd build_v428
python3 -c "
exe = open('staging/IFSC-Station','rb').read() if __import__('os').path.exists('staging/IFSC-Station') else open('staging/QGroundControl','rb').read()
print('LOGO.png in binary:', open('../resources/LOGO.png','rb').read() in exe)
print('IFSC_logo.png in binary:', open('../resources/IFSC_logo.png','rb').read() in exe)
"
```

两个都应输出 `True`。

---

## 6. 调色板：`brandingPurple` 改为深蓝 `#00427F`

**涉及文件**：[src/QGCPalette.cc](src/QGCPalette.cc)

定位 88 行的 `brandingPurple` 默认值（4.2.8）：

```cpp
// 修改前
DECLARE_QGC_NONTHEMED_COLOR(brandingPurple,     "#4A2C6D", "#4A2C6D")
// 修改后
DECLARE_QGC_NONTHEMED_COLOR(brandingPurple,     "#00427F", "#00427F")
```

> 选定 `#00427F` 是因为 QGC 默认的 `mainStatusBGColor`（第 91 行）已是 `#00427F`，改完后整条工具栏的渐变两边将统一为深蓝，不再出现紫→灰过渡。

### 生效位置

- [src/ui/toolbar/MainStatusIndicator.qml:80](src/ui/toolbar/MainStatusIndicator.qml#L80) 的 `qgcPal.brandingPurple`——未连接飞行器时 logo 右侧的 `Disconnected` 状态条底色。

### 重新编译

修改在 C++ 源中，普通 `make` 即可自动重新编译：

```bash
cd build_v428
make -j4
```

---

## 7. 任务栏 / 启动器图标在 AppImage 内的部署

**涉及文件**：
- [deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh)
- [resources/icons/IFSC-Station.png](resources/icons/IFSC-Station.png)

### 7.1 实际验证情况

[QGC 4.2.8 上游原版 `qgroundcontrol-start.sh`](deploy/qgroundcontrol-start.sh) 就是这种"把图标拷到 `~/.icons`"的写法。已实测在 **Ubuntu 24.04** 干净镜像（默认 GNOME）上能正确显示标题栏与任务栏的 IFSC-Station 图标。**因此我们直接保留 QGC 上游的同款做法，未追加任何额外补丁**。

### 7.2 AppRun（[deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh)）最终内容

整段文件完整内容如下（与 QGC 原版 `qgroundcontrol-start.sh` 同构，仅文件名按 IFSC 化替换）：

```sh
#!/bin/sh
HERE="$(dirname "$(readlink -f "${0}")")"

# hack until icon issue with AppImage is resolved
mkdir -p ~/.icons && cp "${HERE}/IFSC-Station.png" ~/.icons

"${HERE}/IFSC-Station" "$@"
```

### 7.3 关于"任务栏 fallback 到默认齿轮"现象的历史说明

早期在 Ubuntu 20.04 等缺默认图标主题依赖的系统上曾观测到任务栏不显示 IFSC-Station 图标的现象。我们经过实测验证：**完整干净的 Ubuntu 24.04 镜像**（默认 GNOME）能正常显示 IFSC-Station 图标；问题来自系统本身缺图标主题，而不是 AppImage 制作缺漏。

如果以后确实需要在 Ubuntu 20.04（缺图标主题）这样的环境也正确显示图标，可以单独处理：

- 把 `IFSC-Station.png` 拷到 `/usr/share/pixmaps`（需要 sudo）；
- 或安装 `hicolor-icon-theme`：`sudo apt install hicolor-icon-theme`。

这些**不写入**打包脚本，避免在已经能正常工作的 24.04 上引入新依赖。

---
## 8. AppImage 打包脚本完整使用流程

### 8.1 一次性构建 release

```bash
cd .
qmake qgroundcontrol.pro -spec linux-g++ CONFIG+=release
make -j$(nproc) release
```

> QGC 4.2.8 默认 Makefile target 会输出到 `build_<ver>/staging/`。本书示例以 `build_v428/staging/` 为准。

### 8.2 重新打 AppImage

```bash
chmod +x deploy/create_IFSC-Station_appimage.sh
./deploy/create_IFSC-Station_appimage.sh \
    /path/to/qgroundcontrol \
    /path/to/build_v428/staging \
    /path/to/output
```

### 8.3 产物清单

打包结束后 `output/` 下应至少出现：

```
IFSC-Station.AppImage    ← 唯一产物，单文件 AppImage
```

### 8.4 关于 RPATH 与运行时库

> **本节为历史说明：**当前 [create_IFSC-Station_appimage.sh](deploy/create_IFSC-Station_appimage.sh) 实际上**未做**任何对 Qt 间接依赖的额外打包、ICU SONAME 修复或 RPATH 修改——这些是 7 月 7 日 16:18 之后为兼容 Ubuntu 20.04 增设的代码段。后经实测确认原始脚本（不增补丁）在 **Ubuntu 24.04** 干净镜像上能够正常启动运行，因此 7.3 段已回退到与 QGC 上游一致的等价状态。

脚本默认假设目标系统 **≥ GLIBC 2.14**（与上游相同）。

### 8.5 `create_IFSC-Station_appimage.sh` 从 `create_linux_appimage.sh` 修改对照表

`deploy/create_IFSC-Station_appimage.sh` 不是凭空写的，而是**逐条改自上游** [deploy/create_linux_appimage.sh](deploy/create_linux_appimage.sh)。两份脚本同在 `deploy/` 下，可直接 `diff` 对照。下表是 IFSC-Station 相对原版**每一处的差异及其动机**（**已剔除** 7.3 段被回退掉的 7 项基础设施级补丁）。

| # | 位置（原版行号 → IFSC 版行号） | 原版 (`create_linux_appimage.sh`) | IFSC 版 (`create_IFSC-Station_appimage.sh`) | 动机 |
|---|---|---|---|---|
| 1 | 顶部注释（1 → 1-5） | （无项目名） | `# IFSC-Station AppImage 打包脚本 / 基于 QGroundControl 的 create_linux_appimage.sh 修改而来 / 用法: ./create_IFSC-Station_appimage.sh <IFSC-Station_src_dir> <build_release_dir> [output_dir]` | 明确文件归属，避免混用 |
| 2 | usage 错误信息（7 → 10-13） | `create_linux_appimage.sh QGC_SRC_DIR QGC_RELEASE_DIR` | `create_IFSC-Station_appimage.sh IFSC-Station_SRC_DIR IFSC-Station_RELEASE_DIR [OUTPUT_DIR]` | 命令名同步替换 |
| 3 | 默认值（13-18 → 18-23） | `APP_NAME=QGroundControl`、`BINARY=QGroundControl`、`START_SH=qgroundcontrol-start.sh`、`ICON=qgroundcontrol.png`、`ICON_NAME=QGroundControl` | `APP_NAME=IFSC-Station`、`BINARY=IFSC-Station`、`START_SH=IFSC-Station-start.sh`、`ICON=IFSC-Station.png`、`ICON_NAME=IFSC-Station` | 二进制与品牌名同步到 IFSC-Station |
| 4 | 缺少 `OUTPUT_DIR` 路径校验（31-33 → 37-39） | 接收第 3 个参数但缺省时直接当输出目录 | 在第 3 参为空时 `OUTPUT_DIR=$(readlink -f \`pwd\`)` 并打印 | 多打印了一行调试提示，便于 CI |
| 5 | `AppRun` 复制（63 → 67） | `cp qgroundcontrol-start.sh AppRun` | `cp IFSC-Station-start.sh AppRun` | 配套 IFSC-Station 自定义启动脚本 |
| 6 | `rsync` 注释（60 → 66） | `# copy QGroundControl release into appimage` | `# copy IFSC-Station release into appimage` | 仅注释变化 |

### 用 `diff` 复核

可随时用下面命令核对 IFSC 版相对上游原版的全部差异：

```bash
diff -u deploy/create_linux_appimage.sh deploy/create_IFSC-Station_appimage.sh | less
```

### 回溯与现状总结

当前 IFSC 版**仅保留 6 项与品牌名相关的等价替换**（#1-#6），整体结构与上游 [create_linux_appimage.sh](deploy/create_linux_appimage.sh) 等价。早期为尝试在 Ubuntu 20.04（GLIBC < 2.14 老系统）也能正确启动而追加的 `#7 appimagetool 本地化`、`#8 BUNDLED_LIBS`、`#9 ICU SONAME`、`#10 patchelf RPATH`、`#11 同名 PNG/SVG 输出`、`#12 外部 .desktop 输出` 等 7 处补丁（对应回退前 16 行表中的 #7-#14），已经在 7.3 节确认 Ubuntu 24.04 实测可直接运行后**全部回退**，不再引入。


## 9. 关于 `custom-example/` 目录的取舍

QGC 4.2.8 官方 `custom-example/` 是一套独立 CustomPlugin 的示例（自定义 `QGCCorePlugin` 子类 + `paletteOverride()` 重写整套调色板 + `qgroundcontrol.qrc` 整体替换）。它的完整二开流程需要：

- 在仓库根建立 `custom/` 目录（重命名 `custom-example/`）；
- 编写 `CustomPlugin.cc` / `CustomPlugin.h`，其 `paletteOverride()` 覆盖每个颜色键 4 个状态值（参考 [custom-example/src/CustomPlugin.cc:174-362](custom-example/src/CustomPlugin.cc#L174-L362)）；
- `qgroundcontrol.pro` 中通过 `CustomBuild` 开关自动加载 `custom/*.qrc`，最终编出 `CustomQGroundControl` 二进制。

**我们的 IFSC-Station 不走这条路**，理由：

1. 项目根目录长期保持单 `QGroundControl` 二进制，避免维护两套 binary；
2. 我们所做的定制很少（仅 5 处色键、2 张 PNG、2 处文字），直接改 `QGCPalette.cc` / `FlyViewWidgetLayer.qml` 等量级更小；
3. 完全干净复现更简单——不需要拉起 custom-example 模板。

如果将来变动量增大（比如调色板整体换肤、应用图标全套自定义、动效深度定制），可以平滑切换到 `custom-example` 路径，把 `paletteOverride()` 内对应颜色块改成 `#00427F` 并注册资源即可。

---

## 10. 改动文件清单（相对仓库根 `.`）

| 路径 | 作用 |
|---|---|
| [src/QGCApplication.cc](src/QGCApplication.cc) | 窗口标题 = `IFSC Station`；关闭 `New Version Available` 弹窗 |
| [src/ui/MainRootWindow.qml](src/ui/MainRootWindow.qml) | 主窗口底部版本号：label 改为 `IFSC Station` + `V1.0` 居中 |
| [src/ui/preferences/GeneralSettings.qml](src/ui/preferences/GeneralSettings.qml) | App Settings 面板版本号改为 `IFSC Station` + `V1.0` 居中 |
| [resources/QGCLogoFull.svg](resources/QGCLogoFull.svg) | 工具栏左上角 / 飞行地图朝向 logo |
| [resources/QGCLogoWhite.svg](resources/QGCLogoWhite.svg) | AppSettings 顶栏 logo |
| [resources/QGCLogoBlack.svg](resources/QGCLogoBlack.svg) | 备用 logo |
| [qgcresources.qrc](qgcresources.qrc) | 注册 `LOGO.png` / `IFSC_logo.png`（必须写在 `/res` 块内） |
| [resources/LOGO.png](resources/LOGO.png) | 主界面右上角品牌 logo（cscad 用户提供） |
| [resources/IFSC_logo.png](resources/IFSC_logo.png) | 主界面右上角 IFSC logo（cscad 用户提供） |
| [src/FlightDisplay/FlyViewWidgetLayer.qml](src/FlightDisplay/FlyViewWidgetLayer.qml) | 飞行视图右上角两个 Image 的 `source` 改为 `qrc:/res/...` |
| [src/QGCPalette.cc](src/QGCPalette.cc) | `brandingPurple` 由 `#4A2C6D` 改为 `#00427F` |
| [deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh) | AppRun：与 QGC 原版同构，仅 `cp ${HERE}/IFSC-Station.png ~/.icons` 一行 |
| [deploy/create_IFSC-Station_appimage.sh](deploy/create_IFSC-Station_appimage.sh) | 打包脚本：6 处品牌名替换的等价微调版（与上游 `create_linux_appimage.sh` 一一对应） |
| [resources/icons/IFSC-Station.png](resources/icons/IFSC-Station.png) | AppImage 应用图标（`.desktop Icon=IFSC-Station` 用） |

---

## 11. 复现检查清单（在干净 QGC 4.2.8 源码上的最小动作）

按顺序执行下列 11 步，全部成功即视为复现完整：

- [ ] 1. 替换 `src/QGCApplication.cc` 中 `applicationName = QStringLiteral("IFSC Station");`
- [ ] 2. 关闭版本检查块（`if (false)` 或注释 `_versionCheckDone`）
- [ ] 3. 修改 `src/ui/MainRootWindow.qml` 版本号两行 label
- [ ] 4. 修改 `src/ui/preferences/GeneralSettings.qml` 版本号两行 label
- [ ] 5. 替换 `resources/QGCLogoFull.svg` / `QGCLogoWhite.svg` / `QGCLogoBlack.svg`
- [ ] 6. 拷贝 `LOGO.png` 与 `IFSC_logo.png` 到 `resources/`，并在 `qgcresources.qrc` 的 `/res` 块内注册
- [ ] 7. 修改 `FlyViewWidgetLayer.qml` 两个 Image 的 source 为 `qrc:/res/...`
- [ ] 8. 修改 `QGCPalette.cc` 的 `brandingPurple` 为 `#00427F`
- [ ] 9. `cd build_v428 && touch ../qgcresources.qrc && rm -f qrc_qgcresources.o && make -j$(nproc)`
- [ ] 10. 用 `deploy/create_IFSC-Station_appimage.sh` 重打 AppImage，确认输出目录里有 `IFSC-Station.AppImage`（单文件即可）
- [ ] 11. 在另一台 **Ubuntu 24.04** 上双击 `IFSC-Station.AppImage`：窗口标题应为 `IFSC Station`，任务栏图标应为 `IFSC-Station`，主界面左上角 logo 区与右上角两个 LOGO 均应显示，整条工具栏主题色为深蓝

---

## 12. 验证嵌入与正确性的几个脚本（均可直接复制执行）

```bash
# 验证 logo SVG 已嵌入二进制
cd build_v428
python3 -c "
data = open('staging/IFSC-Station','rb').read() if __import__('os').path.exists('staging/IFSC-Station') else open('staging/QGroundControl','rb').read()
for f in ['../resources/QGCLogoWhite.svg','../resources/QGCLogoFull.svg','../resources/LOGO.png','../resources/IFSC_logo.png']:
    print(f, '->', ('OK' if open(f,'rb').read() in data else 'MISSING'))
"

# 验证 brandingPurple 已变 #00427F
strings staging/IFSC-Station | grep -E '^#0(0)?0427F' | head -1

# 验证 AppImage 产物（仅一个 .AppImage 文件）
ls -la output/IFSC-Station.AppImage
```

---

附：本手册与 [deploy/create_IFSC-Station_appimage.sh](deploy/create_IFSC-Station_appimage.sh) / [deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh) 三处文件配套更新；任何一处源码回退都必须同步这三份。
