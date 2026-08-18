#!/usr/bin/env python3
# IFSC-Station 网页版启动器 (跨平台)
# 修复 Windows 上 SVG/字体 MIME 类型问题
import os, sys, socket, subprocess, threading, http.server, socketserver, mimetypes, argparse, urllib.request

_EXTRA_MIMES = {
    '.svg':  'image/svg+xml',
    '.svgz': 'image/svg+xml',
    '.ttf':  'font/ttf',
    '.otf':  'font/otf',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.eot':  'application/vnd.ms-fontobject',
    '.ico':  'image/x-icon',
    '.webp': 'image/webp',
    '.json': 'application/json; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.wasm': 'application/wasm',
    '.map':  'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
}
for ext, mt in _EXTRA_MIMES.items():
    mimetypes.add_type(mt, ext)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '404' in fmt or 'error' in fmt.lower():
            sys.stderr.write('[http] ' + fmt % args + '\n')


def is_port_in_use(port):
    # Try to BIND the port — more reliable than connect() because
    # connect() can succeed against connections in TIME_WAIT state
    # (which is a closed port, not actually a listening service).
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(('127.0.0.1', port))
        return False
    except (OSError,):
        return True
    finally:
        s.close()


def find_free_port(preferred):
    if not is_port_in_use(preferred):
        return preferred
    for p in range(preferred + 1, preferred + 11):
        if not is_port_in_use(p):
            return p
    return None


def is_http_alive(port):
    # 端口上是否已有可用的 HTTP 服务 (GET / 返回 2xx/3xx)
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=1.5) as resp:
            return resp.status < 400
    except Exception:
        return False


def open_browser(url):
    try:
        if sys.platform == 'win32':
            # Windows: 用 os.startfile (最可靠, 等同于资源管理器双击)
            os.startfile(url)
        elif sys.platform == 'darwin':
            subprocess.Popen(['open', url])
        else:
            # Linux: xdg-open (避免 webbrowser 模块的环境问题)
            subprocess.Popen(['xdg-open', url],
                             stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
    except Exception as e:
        print(f'⚠  无法自动打开浏览器: {e}', file=sys.stderr)
        print(f'   请手动访问: {url}', file=sys.stderr)


def find_serial_device():
    # 检测已连接的飞控串口 (Linux/macOS: /dev/ttyACM* / /dev/ttyUSB*)
    if sys.platform.startswith('win'):
        return None  # Windows 直接用 Web Serial 连接, 无需桥接
    import glob
    for pat in ('/dev/ttyACM*', '/dev/ttyUSB*'):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    return None


def start_bridge(script_dir, bridge_port):
    """自动启动 MAVLink WebSocket 桥接 (ws_bridge.py). 已在运行/无串口时跳过."""
    if is_port_in_use(bridge_port):
        print(f'ℹ  已检测到 WebSocket 桥接在运行: ws://localhost:{bridge_port}')
        return None
    dev = find_serial_device()
    if not dev:
        print('ℹ  未检测到飞控串口设备, 跳过 WebSocket 桥接')
        print('   连接飞控后运行: python3 ws_bridge.py   (或直接使用 Web Serial)')
        return None
    try:
        proc = subprocess.Popen(
            [sys.executable, os.path.join(script_dir, 'ws_bridge.py'),
             '--port', dev, '--ws', str(bridge_port)],
            cwd=script_dir,
        )
        print(f'✅ 已启动 WebSocket 桥接: {dev} @115200 → ws://localhost:{bridge_port}')
        return proc
    except Exception as e:
        print(f'⚠  启动 WebSocket 桥接失败: {e}', file=sys.stderr)
        return None


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

def main():
    ap = argparse.ArgumentParser(description='IFSC-Station 网页版启动器')
    ap.add_argument('--port', '-p', type=int, default=8000)
    ap.add_argument('--no-browser', action='store_true')
    ap.add_argument('--bind', '-b', default='127.0.0.1')
    ap.add_argument('--no-bridge', action='store_true',
                    help='不自动启动 WebSocket 桥接 (ws_bridge.py)')
    ap.add_argument('--bridge-port', type=int, default=8766,
                    help='WebSocket 桥接端口 (默认 8766)')
    a = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    bridge_proc = None

    # 一键打开: 服务已在运行 → 直接打开浏览器, 不再重复启动
    if is_http_alive(a.port):
        url = f'http://localhost:{a.port}/'
        print(f'✅ IFSC-Station 已在运行: {url}')
        if not a.no_bridge:
            start_bridge(script_dir, a.bridge_port)
        if not a.no_browser:
            open_browser(url)
        return

    print('=' * 60)
    print('  IFSC-Station 网页版启动器')
    print('=' * 60)
    print(f'  工作目录: {script_dir}')
    print(f'  Python:   {sys.version.split()[0]} ({sys.platform})')
    print('=' * 60)

    # 自动启动 WebSocket 桥接 (飞控已连接时)
    if not a.no_bridge:
        bridge_proc = start_bridge(script_dir, a.bridge_port)

    port = find_free_port(a.port)
    if port is None:
        print(f'❌ 端口 {a.port}-{a.port+10} 全被占用', file=sys.stderr)
        if bridge_proc: bridge_proc.terminate()
        sys.exit(1)
    if port != a.port:
        print(f'⚠  端口 {a.port} 已被占用, 改用 {port}')

    url = f'http://localhost:{port}/'
    print(f'📡 启动 HTTP 服务: {url}')
    print(f'   绑定地址: {a.bind}:{port}')
    print('   按 Ctrl+C 退出')
    print('=' * 60)

    if not a.no_browser:
        threading.Timer(0.5, open_browser, args=(url,)).start()

    try:
        with socketserver.TCPServer((a.bind, port), Handler) as srv:
            srv.allow_reuse_address = True
            try:
                srv.serve_forever()
            except KeyboardInterrupt:
                print('\n🛑 收到 Ctrl+C, 正在关闭...')
                srv.shutdown()
    except OSError as e:
        if e.errno in (10048, 98):  # EADDRINUSE
            print(f'❌ 端口 {port} 仍被占用', file=sys.stderr)
            sys.exit(1)
        raise
    except KeyboardInterrupt:
        print('\n🛑 退出')
    finally:
        if bridge_proc:
            print('正在关闭 WebSocket 桥接...')
            bridge_proc.terminate()
            try:
                bridge_proc.wait(timeout=3)
            except Exception:
                bridge_proc.kill()


if __name__ == '__main__':
    main()
