#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ws_bridge.py — MAVLink WebSocket 桥 (纯 Python 标准库 + pyserial, 零额外依赖)
#
# 为什么需要它:
#   部分飞控 (如 Pixhawk 6C / FMU v6C) 的 USB CDC 口对 Web Serial API 的打开方式敏感:
#   浏览器 open() 时 DTR 控制线变化会触发飞控 USB 复位并重新枚举进入 bootloader,
#   Chrome 随即报 "NetworkError: The device has been lost.", 姿态/参数/日志全部失效。
#   (桌面端 QGC 的串口打开方式不同, 不会触发, 所以桌面端一切正常)
#
#   本桥用 pyserial 打开串口 (与 QGC 同级别的稳定方式), 并让串口在整个程序生命周期内
#   保持打开 (避免反复 open/close 再次触发 USB 复位), 通过 WebSocket 把 MAVLink
#   字节流双向转发给网页端。
#
# 用法:
#   python3 ws_bridge.py                  # 默认 /dev/ttyACM0 @115200, WS 端口 8766
#   python3 ws_bridge.py --baud 921600    # 自定义波特率
#   python3 ws_bridge.py --ws 9000        # 自定义 WS 端口
#
# 然后网页端: Connect 弹窗 -> 选 "WebSocket Bridge" -> URL 填 ws://localhost:8766

import argparse
import base64
import hashlib
import socket
import struct
import sys
import threading

try:
    import serial
except ImportError:
    sys.stderr.write("缺少 pyserial 库: pip3 install pyserial\n")
    sys.exit(1)

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


# ---------------- WebSocket 协议 (RFC 6455, 服务端最小实现) ----------------
def _recv_exact(conn, n):
    buf = b""
    while len(buf) < n:
        try:
            chunk = conn.recv(n - len(buf))
        except OSError:
            return None
        if not chunk:
            return None
        buf += chunk
    return buf


def ws_handshake(conn):
    """完成 HTTP Upgrade 握手, 成功返回 True"""
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(4096)
        if not chunk:
            return False
        data += chunk
    headers = data.decode("latin1")
    key = None
    for line in headers.split("\r\n"):
        if line.lower().startswith("sec-websocket-key:"):
            key = line.split(":", 1)[1].strip()
            break
    if not key:
        return False
    accept = base64.b64encode(
        hashlib.sha1((key + WS_GUID).encode("ascii")).digest()
    ).decode("ascii")
    conn.sendall((
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n"
        "\r\n"
    ).encode("ascii"))
    return True


def ws_read_frame(conn):
    """读一帧。返回 (opcode, payload); 连接关闭/出错返回 (None, None)"""
    hdr = _recv_exact(conn, 2)
    if hdr is None:
        return None, None
    b0, b1 = hdr[0], hdr[1]
    opcode = b0 & 0x0F
    masked = b1 & 0x80
    length = b1 & 0x7F
    if length == 126:
        ext = _recv_exact(conn, 2)
        if ext is None:
            return None, None
        length = struct.unpack(">H", ext)[0]
    elif length == 127:
        ext = _recv_exact(conn, 8)
        if ext is None:
            return None, None
        length = struct.unpack(">Q", ext)[0]
    mask_key = b""
    if masked:
        mask_key = _recv_exact(conn, 4)
        if mask_key is None:
            return None, None
    payload = _recv_exact(conn, length) if length else b""
    if payload is None:
        return None, None
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def ws_send(conn, payload, opcode=0x2):
    """发送一帧 (服务端帧不掩码)。opcode: 0x1=text, 0x2=binary, 0xA=pong"""
    b0 = 0x80 | opcode          # FIN=1
    n = len(payload)
    if n < 126:
        header = struct.pack("!BB", b0, n)
    elif n < 65536:
        header = struct.pack("!BBH", b0, 126, n)
    else:
        header = struct.pack("!BBQ", b0, 127, n)
    conn.sendall(header + payload)


# ---------------- 客户端处理 ----------------
def handle_client(conn, ser, write_lock, stop_evt):
    peer = "?"
    try:
        peer = str(conn.getpeername())
        if not ws_handshake(conn):
            return
        print(f"[WS] 浏览器已连接: {peer}   (串口持续保持打开)")

        def rx_loop():
            """串口 RX -> WebSocket TX"""
            while not stop_evt.is_set():
                try:
                    data = ser.read(4096)
                except Exception as e:
                    print(f"[ERR] 串口读取失败: {e}")
                    break
                if not data:
                    continue
                try:
                    ws_send(conn, data, 0x2)
                except OSError:
                    break

        t = threading.Thread(target=rx_loop, daemon=True)
        t.start()

        # WebSocket RX -> 串口 TX
        while not stop_evt.is_set():
            opcode, payload = ws_read_frame(conn)
            if opcode is None:
                break
            if opcode == 0x8:          # close
                break
            if opcode == 0x9:          # ping -> pong
                try:
                    ws_send(conn, payload, 0xA)
                except OSError:
                    break
                continue
            if opcode in (0x1, 0x2) and payload:   # text / binary
                with write_lock:
                    try:
                        ser.write(payload)
                    except Exception as e:
                        print(f"[ERR] 串口写入失败: {e}")
                        break
        print(f"[WS] 浏览器断开: {peer}")
    except OSError:
        pass
    finally:
        try:
            conn.close()
        except OSError:
            pass


# ---------------- 主入口 ----------------
def main():
    ap = argparse.ArgumentParser(description="MAVLink WebSocket 桥 (串口 <-> 网页端)")
    ap.add_argument("--port", default="/dev/ttyACM0", help="串口设备 (默认 /dev/ttyACM0)")
    ap.add_argument("--baud", type=int, default=115200, help="波特率 (默认 115200)")
    ap.add_argument("--ws", type=int, default=8766, help="WebSocket 监听端口 (默认 8766)")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址 (默认 127.0.0.1)")
    a = ap.parse_args()

    print("=" * 60)
    print("  IFSC-Station MAVLink WebSocket 桥")
    print("=" * 60)
    print(f"  串口:    {a.port} @ {a.baud}")
    print(f"  网页端连: ws://{a.host}:{a.ws}")

    try:
        ser = serial.Serial(a.port, a.baud, timeout=0.05)
    except serial.SerialException as e:
        print(f"❌ 打开串口失败: {e}")
        print("  请检查: 1) 飞控是否已连接 2) 串口是否被 QGC 等程序占用 3) 端口名是否正确")
        sys.exit(1)

    print(f"✅ 串口已打开 (保持常开, 不反复复位 USB)")
    write_lock = threading.Lock()
    stop_evt = threading.Event()

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((a.host, a.ws))
    except OSError as e:
        print(f"❌ 监听 ws://{a.host}:{a.ws} 失败: {e} (端口可能被占用)")
        ser.close()
        sys.exit(1)
    srv.listen(1)
    print(f"✅ 等待浏览器连接: ws://{a.host}:{a.ws}   (Ctrl+C 退出)")

    try:
        while not stop_evt.is_set():
            conn, _ = srv.accept()
            handle_client(conn, ser, write_lock, stop_evt)
    except KeyboardInterrupt:
        print("\n🛑 收到 Ctrl+C, 正在退出...")
    finally:
        stop_evt.set()
        try:
            srv.close()
        except OSError:
            pass
        try:
            ser.close()
        except Exception:
            pass
        print("串口已关闭, 再见")


if __name__ == "__main__":
    main()
