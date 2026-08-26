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

## 7. 任务栏 / 启动器图标在 AppImage 跨机器显示修复

**涉及文件**：
- [deploy/create_IFSC-Station_appimage.sh](deploy/create_IFSC-Station_appimage.sh)
- [deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh)
- [resources/icons/IFSC-Station.png](resources/icons/IFSC-Station.png)

### 7.1 根因

原方案只做了 `cp IFSC-Station.png ~/.icons`（在 AppRun 中），对窗口标题栏图标生效，但**任务栏/启动器**只读 `.desktop` 的 `Icon=` 字段和 AppImage 同名 PNG/SVG，单独的 `~/.icons` 并不够；结果在另一台 Ubuntu 上任务栏图标 fallback 到默认齿轮图案。

### 7.2 修复：打包时输出同名 PNG + .desktop，启动时多路径部署

#### 改动 A：[deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh) 在启动时把图标部署到所有主流桌面位置

```sh
#!/bin/sh
HERE="$(dirname "$(readlink -f "${0}")")"
APP_NAME="IFSC-Station"

# 1) 用户级图标目录（GNOME/KDE/XFCE 自动搜索）
mkdir -p "$HOME/.icons" && cp -f "${HERE}/${APP_NAME}.png" "$HOME/.icons/${APP_NAME}.png"

# 2) hicolor 主题目录（freedesktop 标准，应用抽屉、文件管理器首选）
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
cp -f "${HERE}/${APP_NAME}.png" "$HOME/.local/share/icons/hicolor/256x256/apps/${APP_NAME}.png"

# 3) 部署 .desktop，让任务栏按 StartupWMClass 匹配窗口
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/${APP_NAME}.desktop" <<DESKTOP_EOF
[Desktop Entry]
Type=Application
Name=IFSC Station
GenericName=Ground Control Station
Comment=UAS ground control station
Icon=${APP_NAME}
Exec=${HERE}/${APP_NAME} %u
Terminal=false
Categories=Utility;Science;
StartupNotify=true
StartupWMClass=IFSC Station
DESKTOP_EOF

# 4) 刷新图标缓存（部分桌面需要；失败也无所谓）
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" || true

exec "${HERE}/${APP_NAME}" "$@"
```

#### 改动 B：[deploy/create_IFSC-Station_appimage.sh](deploy/create_IFSC-Station_appimage.sh) 输出阶段生成同名 PNG 与 .desktop

在脚本末尾 `cp ${TMPDIR}/$APP.AppImage ${OUTPUT_DIR}/$APP.AppImage` 之后追加：

```bash
# ---- 任务栏/启动器同名 PNG + SVG ----
if [ -f "${QGC_CUSTOM_APP_ICON}" ]; then
    cp "${QGC_CUSTOM_APP_ICON}" "${OUTPUT_DIR}/${APP}.png"
    svg_candidate="${QGC_CUSTOM_APP_ICON%.*}.svg"
    [ -f "${svg_candidate}" ] && cp "${svg_candidate}" "${OUTPUT_DIR}/${APP}.svg"
fi

# ---- 同步输出 .desktop（用户手工安装到 ~/.local/share/applications） ----
cat > ${OUTPUT_DIR}/${APP}.desktop <<EOF
[Desktop Entry]
Type=Application
Name=${QGC_CUSTOM_APP_NAME}
GenericName=${QGC_CUSTOM_GENERIC_NAME}
Comment=UAS ground control station
Icon=${APP}
Exec=${APP}.AppImage %u
Terminal=false
Categories=Utility;Science;
Keywords=drone;uav;ground;control;station;
StartupNotify=true
StartupWMClass=${QGC_CUSTOM_APP_NAME}
EOF
chmod +x ${OUTPUT_DIR}/${APP}.desktop
```

### 7.3 用户在目标机器上的三种使用方式

**方式 A（最简，单文件 AppImage）**：把 AppImage 文件同目录带上 `IFSC-Station.png`（可选 `.svg`），启动一次后 AppRun 自动部署到 `~/.icons` 和 `~/.local/share/icons/hicolor/`。

**方式 B（推荐，用生成的 .desktop）**：

```bash
cp IFSC-Station.desktop  ~/.local/share/applications/
update-desktop-database ~/.local/share/applications/   # 可选
gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor   # 可选
```

**方式 C（AppImageLauncher，最省心）**：Ubuntu 装 `appimagelauncher-daemon`，首次双击会自动从同名 `.png` 提取并注册到启动器。

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
IFSC-Station.AppImage
IFSC-Station.png                       ← 跨机器任务栏图标必备
IFSC-Station.svg                       ← （可选）若 resources/icons/IFSC-Station.svg 存在
IFSC-Station.desktop                   ← 可手工安装到 ~/.local/share/applications/
```

### 8.4 关于 RPATH 与运行时库

打包脚本已经做过如下处理：
- `script` 中段会从 `/usr/lib` / `/usr/lib/x86_64-linux-gnu` 拷贝一批 Qt 间接依赖（`libmd4c.so.0`、`libSM.so.6` 等）；
- 修复 `libicudata.so.70` / `libicuuc.so.70` 的 SONAME 符号链接；
- 修复 Qt 主库 + 插件 + QML 插件的 RPATH（依赖 `patchelf`，未安装时降级但不报错）。

> 若目标机 GLIBC < 2.14，可能仍然跑不起来；脚本默认假设目标 ≥ 2.14。

### 8.5 `create_IFSC-Station_appimage.sh` 从 `create_linux_appimage.sh` 修改对照表

`deploy/create_IFSC-Station_appimage.sh` 不是凭空写的，而是**逐条改自上游** [deploy/create_linux_appimage.sh](deploy/create_linux_appimage.sh)。两份脚本同在 `deploy/` 下，可直接 `diff` 对照。下表是 IFSC-Station 相对原版**每一处的差异及其动机**。

| # | 位置（原版行号 → IFSC 版行号） | 原版 (`create_linux_appimage.sh`) | IFSC 版 (`create_IFSC-Station_appimage.sh`) | 动机 |
|---|---|---|---|---|
| 1 | 顶部注释（1 → 1-5） | （无项目名） | `# IFSC-Station AppImage 打包脚本 / 基于 QGroundControl 的 create_linux_appimage.sh 修改而来 / 用法: ./create_IFSC-Station_appimage.sh <IFSC-Station_src_dir> <build_release_dir> [output_dir]` | 明确文件归属，避免混用 |
| 2 | usage 错误信息（7 → 10-13） | `create_linux_appimage.sh QGC_SRC_DIR QGC_RELEASE_DIR` | `create_IFSC-Station_appimage.sh IFSC-Station_SRC_DIR IFSC-Station_RELEASE_DIR [OUTPUT_DIR]` | 命令名同步替换 |
| 3 | 默认值（13-18 → 18-23） | `APP_NAME=QGroundControl`、`BINARY=QGroundControl`、`START_SH=qgroundcontrol-start.sh`、`ICON=qgroundcontrol.png`、`ICON_NAME=QGroundControl` | `APP_NAME=IFSC-Station`、`BINARY=IFSC-Station`、`START_SH=IFSC-Station-start.sh`、`ICON=IFSC-Station.png`、`ICON_NAME=IFSC-Station` | 二进制与品牌名同步到 IFSC-Station |
| 4 | 缺少 `OUTPUT_DIR` 路径校验（31-33 → 37-39） | 接收第 3 个参数但缺省时直接当输出目录 | 在第 3 参为空时 `OUTPUT_DIR=$(readlink -f \`pwd\`)` 并打印 | 多打印了一行调试提示，便于 CI |
| 5 | `AppRun` 复制（63 → 175-176） | `cp qgroundcontrol-start.sh AppRun` | `cp IFSC-Station-start.sh AppRun` | 配套 IFSC-Station 自定义启动脚本 |
| 6 | `.desktop` 文件（68-79 → 181-192） | `cat > ./QGroundControl.desktop <<\EOF` (用 `<<\EOF` 转义变量) | `cat > ./${APP}.desktop <<EOF`（变量展开） | 跨发行版兼容性：`StartupWMClass` 等字段后补正确匹配 |
| 7 | `appimagetool` 下载（86 → 197-207） | 每次远程 `wget` 下载 12 号 release | **改用本地** `${APPIMAGETOOL_LOCAL:-/home/lu/appimagetool-x86_64.AppImage}`，找不到则报错 | 网络受限时也能完成打包；国内 CI 友好 |
| 8 | 主流程后补：`BUNDLED_LIBS` 列表（无 → 72-106） | （无） | 新增 `libmd4c.so.0`、`libSM.so.6`、`libICE.so.6`、`libjpeg.so.8`、`libQt5EglFSDeviceIntegration.so.5`、`libmtdev.so.1`、`libinput.so.10`、`libsqlite3.so.0`、`libflite.so.1`、`libflite_cmu_us_kal.so.1`、`libflite_cmu_us_kal16.so.1` 等 Qt 间接依赖的自动查 / 找 / 拷贝 | 解决了上一版在"无系统 Qt5"的目标机器上跑不起来的问题 |
| 9 | 主流程后补：ICU SONAME 链接（无 → 110-123） | （无） | `libicudata.so.70` / `libicuuc.so.70` 的 SONAME 符号链接自动建立 | 上一版 Qt 编译产物缺 SONAME，AppImage 双击报缺库 |
| 10 | 主流程后补：`patchelf` RPATH 修复（无 → 125-173） | （无） | 用 `patchelf` 给主二进制 + `Qt/libs/*.so` + `Qt/plugins/*/*.so` + `Qt/qml/*.so` 设 RPATH（缺则降级不报错） | 解决插件库自身缺 RPATH 的二级库找不到问题；`patchelf` 不存在时**不致命**，降级提示用户安装 |
| 11 | 输出阶段：图标复制（66 → 178-179） | `cp ${QGC_CUSTOM_APP_ICON} ${APPDIR}/` | 同上，但同时复制同名 `.svg`（若有） | 让 AppDir 内同时拥有 PNG 与 SVG 供不同桌面环境优先解析 |
| 12 | 输出阶段：`.desktop` 多项字段补全（68-79 → 181-192） | 仅 `Type/Name/GenericName/Comment/Icon/Exec/Terminal/Categories/Keywords` | 额外 `StartupNotify=true`、`StartupWMClass=IFSC Station`、`Categories=Utility;Science;`、`Keywords` 扩展 | 让 GNOME Shell 能按 wmclass 关联窗口并显示图标 |
| 13 | **新增**：AppImage 同名 PNG/SVG 输出（无 → 213-228） | （原版产物只有 AppImage 一个文件） | `${OUTPUT_DIR}/${APP}.png` + 可选 `.svg` 由脚本自动 copy | Ubuntu/Debian AppImageLauncher/GNOME Shell 的标准：识别同名 PNG 才能登记任务栏图标 |
| 14 | **新增**：对外发布 `.desktop`（无 → 230-243） | （没有 release .desktop 文件） | 输出 `${OUTPUT_DIR}/${APP}.desktop`，含 `Exec=${APP}.AppImage %u` 等，可手工安装到 `~/.local/share/applications/` | 用户拿到 `.desktop` 一行就能装入启动器 |
| 15 | `rsync` 注释（60 → 66） | `# copy QGroundControl release into appimage` | `# copy IFSC-Station release into appimage` | 仅注释变化 |
| 16 | 脚本自校验（无 → 191-194） | （无） | 通过 `strings ${APPDIR}/${BINARY} | grep '^v[0-9*]\.[0-9*].[0-9*]'` 读取版本 | 调试日志更明确 |

### 用 `diff` 复核

可随时用下面命令核对 IFSC 版相对上游原版的全部差异（两条新加的脚本都基于同一份原版起始）：

```bash
diff -u deploy/create_linux_appimage.sh deploy/create_IFSC-Station_appimage.sh | less
```

### 回溯要点（IFSC 版独有的 4 个增强）

1. **Qt 间接依赖自动打包**（#8）：缺这步直接无法在裸 Ubuntu 上启动；
2. **ICU SONAME 链接**（#9）：缺这步报 `libicudata.so.70 / libicuuc.so.70: cannot open shared object file`；
3. **patchelf RPATH**（#10）：缺这步 Qt 插件自身报 `libQt5Core.so.5: cannot open shared object file`；
4. **同名 PNG + 外部 .desktop**（#13、#14）：缺这步 Ubuntu 任务栏 fallback 到默认齿轮图标。

这 4 项是 IFSC-Station 真正区别于原版的"功能性增强"，其中 #1-#3 是**纯基础设施级**改进（任何 QGC 派生构建都应当带上），#4 是**桌面集成**改进（仅 IFSC-Station 自己关心）。

---

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
| [deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh) | AppRun：图标 + .desktop 多路径部署 |
| [deploy/create_IFSC-Station_appimage.sh](deploy/create_IFSC-Station_appimage.sh) | 打包脚本：输出同名 PNG / SVG / .desktop |
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
- [ ] 10. 用 `deploy/create_IFSC-Station_appimage.sh` 重打 AppImage，确认输出目录里同时有 `IFSC-Station.AppImage` / `IFSC-Station.png` / `IFSC-Station.desktop`
- [ ] 11. 在另一台 Ubuntu 上双击 `IFSC-Station.AppImage` 或把 `IFSC-Station.desktop` 拷到 `~/.local/share/applications/`，确认任务栏左上角图标是 `IFSC-Station`，主界面左上角 logo 区与右上角两个 LOGO 均显示，整条工具栏主题色为深蓝

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

# 验证 AppImage 产物齐全
ls -la output/IFSC-Station.*
```

---

附：本手册与 [deploy/create_IFSC-Station_appimage.sh](deploy/create_IFSC-Station_appimage.sh) / [deploy/IFSC-Station-start.sh](deploy/IFSC-Station-start.sh) 三处文件配套更新；任何一处源码回退都必须同步这三份。
