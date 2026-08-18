#!/usr/bin/env python3
"""
纯 Python 端到端测试 — 验证参数编解码 + WebSocket 流程
1. 启动 mock_mavlink_server.py
2. 用 Python WebSocket 客户端连上去
3. 发 PARAM_REQUEST_LIST, 验证收到 31 个 PARAM_VALUE
4. 发 PARAM_SET, 验证确认回包
"""
import socket, struct, time, base64, hashlib, os, subprocess, sys, json, threading, re
from pathlib import Path

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# ---- MAVLink encoder (同 mock_mavlink_server.py 一样的算法) ----
CRC_TABLE = []
for i in range(256):
    crc = i
    for _ in range(8):
        crc = (crc >> 1) ^ 0x8408 if crc & 1 else crc >> 1
    CRC_TABLE.append(crc)
CRC_EXTRA = {
    0:   50,   # HEARTBEAT
    1:  124,   # SYS_STATUS
    20: 214,   # PARAM_REQUEST_READ
    21: 159,   # PARAM_REQUEST_LIST
    22: 220,   # PARAM_VALUE
    23: 168,   # PARAM_SET
    24:  24,   # GPS_RAW_INT
    30:  39,   # ATTITUDE
    33: 104,   # GLOBAL_POSITION_INT
    35: 244,   # RC_CHANNELS_RAW
    76: 152,   # COMMAND_LONG
    77: 143,   # COMMAND_ACK
    109:185,   # RADIO_STATUS
    110: 84,   # FILE_TRANSFER_PROTOCOL
    253: 83,   # STATUSTEXT
}

def crc_x25(buf, start, end, crc_extra=0):
    crc = 0xFFFF
    for i in range(start, end):
        tmp = (crc ^ buf[i]) & 0xFF
        crc = (crc >> 8) ^ CRC_TABLE[tmp]
    tmp = (crc ^ (crc_extra & 0xFF)) & 0xFF
    crc = (crc >> 8) ^ CRC_TABLE[tmp]
    return crc & 0xFFFF

def build_frame(msgid, sysid, compid, seq, payload, crc_extra=None):
    if crc_extra is None:
        crc_extra = CRC_EXTRA.get(msgid, 0)
    hdr = bytes([0xFD, len(payload) & 0xFF, 0, 0, seq & 0xFF, sysid & 0xFF, compid & 0xFF,
                 msgid & 0xFF, (msgid >> 8) & 0xFF, (msgid >> 16) & 0xFF])
    body = hdr + payload
    crc = crc_x25(body, 1, 10 + len(payload), crc_extra)
    return body + bytes([crc & 0xFF, (crc >> 8) & 0xFF])

def parse_frame(data):
    if len(data) < 12 or data[0] != 0xFD: return None
    plen = data[1]
    msgid = data[7] | (data[8] << 8) | (data[9] << 16)
    if data[2] & 0x01: return None  # signed
    total = 10 + plen + 2
    if len(data) < total: return None
    payload = bytes(data[10:10+plen])
    crc_extra = CRC_EXTRA.get(msgid, 0)
    crc_calc = crc_x25(data, 1, 10 + plen, crc_extra)
    crc_got = data[10+plen] | (data[10+plen+1] << 8)
    if crc_calc != crc_got: return None
    return msgid, data[5], data[6], data[4], payload

# ---- mavlink_param_union_t 位转换 (与 mock server / src/mavlink.js 一致) ----
MAV_PARAM_TYPE = {'REAL32': 1, 'INT32': 7}

def value_to_union(value, ptype):
    """实际值 -> union -> float32 位模式 (写 PARAM_SET 时用)"""
    if ptype == MAV_PARAM_TYPE['INT32']:
        return struct.unpack('<f', struct.pack('<i', int(value)))[0]
    return float(value)

def union_to_value(float_bits, ptype):
    """float32 位模式 -> 按类型解释的实际值 (解析 PARAM_VALUE 时用)"""
    raw = struct.pack('<f', float_bits)
    if ptype == MAV_PARAM_TYPE['INT32']:
        return struct.unpack('<i', raw[0:4])[0]
    return float_bits

# ---- WebSocket client ----
class WSClient:
    def __init__(self, host, port, path='/'):
        self.host = host
        self.port = port
        self.path = path
        self.sock = None
        self.rx_buf = b''
        self.frames = []
        self.connected = False

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f'GET {self.path} HTTP/1.1\r\n'
            f'Host: {self.host}:{self.port}\r\n'
            f'Upgrade: websocket\r\n'
            f'Connection: Upgrade\r\n'
            f'Sec-WebSocket-Key: {key}\r\n'
            f'Sec-WebSocket-Version: 13\r\n'
            f'\r\n'
        )
        self.sock.sendall(req.encode())
        # Read handshake response
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.sock.recv(4096)
            if not chunk: raise ConnectionError('server closed during handshake')
            buf += chunk
        head, _ = buf.split(b'\r\n\r\n', 1)
        if b'101' not in head.split(b'\r\n', 1)[0]:
            raise ConnectionError(f'bad handshake: {head[:200]!r}')
        # Verify Sec-WebSocket-Accept
        m = re.search(rb'Sec-WebSocket-Accept:\s*(\S+)', head, re.IGNORECASE)
        if not m:
            raise ConnectionError('no Sec-WebSocket-Accept')
        accept_expected = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode()).digest()
        )
        accept_got = m.group(1)
        if accept_got != accept_expected:
            raise ConnectionError(f'bad accept: {accept_got!r} != {accept_expected!r}')
        self.connected = True
        print(f'  ✓ WS handshake OK')

    def send(self, payload):
        if not self.connected: raise ConnectionError('not connected')
        # Client->Server frame must be masked
        b1 = 0x82  # FIN + binary
        mask = os.urandom(4)
        if len(payload) < 126:
            hdr = bytes([b1, 0x80 | len(payload)])
        elif len(payload) < 65536:
            hdr = bytes([b1, 0x80 | 126]) + struct.pack('>H', len(payload))
        else:
            hdr = bytes([b1, 0x80 | 127]) + struct.pack('>Q', len(payload))
        masked = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
        self.sock.sendall(hdr + mask + masked)

    def recv_frame(self, timeout=5):
        self.sock.settimeout(timeout)
        try:
            while True:
                # If we already have a complete frame buffered, return it
                while len(self.rx_buf) >= 2:
                    b1, b2 = self.rx_buf[0], self.rx_buf[1]
                    length = b2 & 0x7F
                    idx = 2
                    if length == 126:
                        if len(self.rx_buf) < 4: break
                        length = (self.rx_buf[2] << 8) | self.rx_buf[3]
                        idx = 4
                    elif length == 127:
                        if len(self.rx_buf) < 10: break
                        length = int.from_bytes(self.rx_buf[2:10], 'big')
                        idx = 10
                    if len(self.rx_buf) < idx + length: break
                    payload = bytes(self.rx_buf[idx:idx+length])
                    self.rx_buf = self.rx_buf[idx+length:]
                    if b1 & 0x0F == 0x8:  # close
                        raise ConnectionError('close frame')
                    return payload
                # Need more data
                chunk = self.sock.recv(4096)
                if not chunk: raise ConnectionError('closed')
                self.rx_buf += chunk
        except socket.timeout:
            return None

    def close(self):
        try: self.sock.close()
        except: pass


def run_test():
    print('=' * 60)
    print('  Param E2E Test (Python)')
    print('=' * 60)

    # Start mock server (mock_mavlink_server.py 与本测试同目录)
    print('Starting mock server...')
    proj_dir = Path(__file__).resolve().parent
    mock = subprocess.Popen(
        ['python3', '-u', 'mock_mavlink_server.py'],
        cwd=str(proj_dir), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=0
    )
    time.sleep(2)
    if mock.poll() is not None:
        print('✗ mock server died')
        print('STDOUT:', mock.stdout.read() if mock.stdout else '')
        return False
    print('  ✓ mock server started')

    results = {'ok': True, 'errors': []}
    def fail(msg):
        results['ok'] = False
        results['errors'].append(msg)
        print(f'  ✗ {msg}')
    def ok(msg):
        print(f'  ✓ {msg}')

    try:
        ws = WSClient('127.0.0.1', 8766)
        ws.connect()

        # ---- Test 1: PARAM_REQUEST_LIST ----
        print('\n[1] PARAM_REQUEST_LIST')
        f1 = build_frame(21, 255, 190, 0, struct.pack('<BB', 1, 1))
        print(f'  发送 {len(f1)} 字节')
        ws.send(f1)

        rx_frames = []
        t_start = time.time()
        while time.time() - t_start < 5:
            payload = ws.recv_frame(timeout=0.5)
            if payload is None:
                if rx_frames: break  # 至少收到一些, 0.5s 没有新帧就停了
                continue
            r = parse_frame(payload)
            if r is None: continue
            msgid, sysid, compid, seq, pl = r
            if msgid == 22:  # PARAM_VALUE
                # C 库线上布局: value(f)@0 + count(H)@4 + index(H)@6 + id(z16)@8 + type(B)@24
                float_bits = struct.unpack('<f', pl[0:4])[0]
                pcount = struct.unpack('<H', pl[4:6])[0]
                pindex = struct.unpack('<H', pl[6:8])[0]
                name_b = pl[8:24].rstrip(b'\x00')
                name = name_b.decode('latin-1', errors='replace')
                ptype = pl[24]
                # 关键: 按类型做 union 位转换, 否则 INT32 参数显示为巨大浮点数
                val = union_to_value(float_bits, ptype)
                rx_frames.append({'name': name, 'value': val, 'type': ptype, 'count': pcount, 'index': pindex})

        if len(rx_frames) == 31:
            ok(f'收到 {len(rx_frames)} 个 PARAM_VALUE')
        else:
            fail(f'只收到 {len(rx_frames)} 个 PARAM_VALUE (期望 31)')

        # 检查 SYS_AUTOSTART (INT32 union 位转换: 线上是 1001 的位模式, 解码后应还原为 1001)
        sa = next((f for f in rx_frames if f['name'] == 'SYS_AUTOSTART'), None)
        if sa and sa['value'] == 1001 and sa['type'] == 7:
            ok(f'SYS_AUTOSTART = {sa["value"]} (type={sa["type"]}, INT32 union roundtrip OK)')
        else:
            fail(f'SYS_AUTOSTART 错: {sa}')

        # 检查 param_count
        if sa and sa['count'] == 31:
            ok(f'param_count = {sa["count"]}')
        else:
            fail(f'param_count 错: {sa["count"] if sa else "None"}')

        # ---- Test 2: PARAM_SET (REAL32) ----
        print('\n[2] PARAM_SET MPC_XY_VEL_P = 0.75 (REAL32)')
        name_b = b'MPC_XY_VEL_P'
        name_padded = name_b[:16].ljust(16, b'\x00')
        value = 0.75
        # C 库线上布局: value(f)@0 + target_system(B)@4 + target_component(B)@5 + id(z16)@6 + type(B)@22
        payload = struct.pack('<fBB', value, 1, 1) + name_padded + struct.pack('<B', 1)
        f2 = build_frame(23, 255, 190, 5, payload)
        print(f'  发送 {len(f2)} 字节')
        ws.send(f2)

        # 等待确认
        confirm = None
        all_rx = []
        t_start = time.time()
        while time.time() - t_start < 2:
            data = ws.recv_frame(timeout=0.5)
            if data is None: continue
            r = parse_frame(data)
            if r is None:
                print(f'  [DBG] failed to parse frame: {data.hex()[:80]}...')
                continue
            msgid, sysid, compid, seq, pl = r
            print(f'  [DBG] RX msgid={msgid} sys={sysid} comp={compid} pl={pl.hex()[:60]}')
            if msgid == 22:
                # C 库线上布局: value(f)@0 + id(z16)@8
                float_bits = struct.unpack('<f', pl[0:4])[0]
                pindex = struct.unpack('<H', pl[6:8])[0]
                name_b = pl[8:24].rstrip(b'\x00')
                name = name_b.decode('latin-1', errors='replace')
                ptype = pl[24]
                val = union_to_value(float_bits, ptype)
                all_rx.append({'name': name, 'value': val, 'index': pindex})
                if name == 'MPC_XY_VEL_P':
                    confirm = {'name': name, 'value': val, 'index': pindex}

        if confirm and abs(confirm['value'] - 0.75) < 1e-6:
            ok(f'PARAM_SET 确认: {confirm["name"]} = {confirm["value"]}')
        else:
            fail(f'PARAM_SET 确认失败: {confirm}')
        if confirm and confirm['index'] == 0xFFFF:
            ok(f'写确认 param_index=0xFFFF (PX4 广播风格)')
        else:
            fail(f'写确认 index 错: {confirm["index"] if confirm else None} (期望 65535)')

        # ---- Test 3: PARAM_SET (INT32, union 位转换往返) ----
        print('\n[3] PARAM_SET COM_DL_LOSS_T = 8 (INT32 union roundtrip)')
        name_b = b'COM_DL_LOSS_T'
        name_padded = name_b[:16].ljust(16, b'\x00')
        int_val = 8
        # 关键: 整型参数必须按 union 位模式发送, 否则 PX4 拒收 (这正是网页版以前不能改参数的原因)
        union_bits = value_to_union(int_val, 7)
        payload = struct.pack('<fBB', union_bits, 1, 1) + name_padded + struct.pack('<B', 7)
        f3 = build_frame(23, 255, 190, 6, payload)
        print(f'  发送 union_bits={union_bits!r} ({len(f3)} 字节)')
        ws.send(f3)

        confirm = None
        t_start = time.time()
        while time.time() - t_start < 2:
            data = ws.recv_frame(timeout=0.5)
            if data is None: continue
            r = parse_frame(data)
            if r is None: continue
            msgid, sysid, compid, seq, pl = r
            if msgid == 22:
                float_bits = struct.unpack('<f', pl[0:4])[0]
                pindex = struct.unpack('<H', pl[6:8])[0]
                name_b = pl[8:24].rstrip(b'\x00')
                name = name_b.decode('latin-1', errors='replace')
                ptype = pl[24]
                val = union_to_value(float_bits, ptype)
                if name == 'COM_DL_LOSS_T':
                    confirm = {'name': name, 'value': val, 'type': ptype, 'index': pindex}

        if confirm and confirm['value'] == 8 and confirm['type'] == 7:
            ok(f'INT32 PARAM_SET 确认: {confirm["name"]} = {confirm["value"]} (type=7, 位转换往返一致)')
        else:
            fail(f'INT32 PARAM_SET 确认失败: {confirm}')

        # 重新拉列表验证写入生效
        print('\n[3b] 重新 PARAM_REQUEST_LIST 验证 COM_DL_LOSS_T 已写入')
        f4 = build_frame(21, 255, 190, 7, struct.pack('<BB', 1, 1))
        ws.send(f4)
        rx_frames = []
        t_start = time.time()
        while time.time() - t_start < 5:
            data = ws.recv_frame(timeout=0.5)
            if data is None:
                if rx_frames: break
                continue
            r = parse_frame(data)
            if r is None: continue
            msgid, sysid, compid, seq, pl = r
            if msgid == 22:
                float_bits = struct.unpack('<f', pl[0:4])[0]
                pindex = struct.unpack('<H', pl[6:8])[0]
                name_b = pl[8:24].rstrip(b'\x00')
                name = name_b.decode('latin-1', errors='replace')
                ptype = pl[24]
                rx_frames.append({'name': name, 'value': union_to_value(float_bits, ptype), 'index': pindex})
        cd = next((f for f in rx_frames if f['name'] == 'COM_DL_LOSS_T'), None)
        if cd and cd['value'] == 8:
            ok(f'重新拉取确认: COM_DL_LOSS_T = {cd["value"]} (写入已持久化到 mock)')
        else:
            fail(f'重新拉取 COM_DL_LOSS_T 错: {cd}')

        ws.close()
    finally:
        mock.terminate()
        try: mock.wait(timeout=3)
        except: mock.kill()
        # Print mock log
        out = mock.stdout.read() if mock.stdout else ''
        # Save full log to file
        with open('/tmp/mock_log_e2e.log', 'w') as f:
            f.write(out)
        if 'Error' in out or 'error' in out or '[PARAM]' in out:
            print('\n--- Mock log (last 30 lines) ---')
            for line in out.splitlines()[-30:]:
                print('  ' + line)

    print('\n' + '=' * 60)
    print('  ' + ('✓ ALL PASS' if results['ok'] else f'✗ FAIL ({len(results["errors"])} errors)'))
    print('=' * 60)
    return results['ok']


if __name__ == '__main__':
    ok = run_test()
    sys.exit(0 if ok else 1)
