#!/usr/bin/env python3
"""
Mock MAVLink 飞控服务器 (纯 stdlib)
通过 WebSocket 发送真实 MAVLink v2 字节流, 模拟 PX4 飞行

支持:
  - HEARTBEAT (in/out)
  - ATTITUDE, GLOBAL_POSITION_INT, GPS_RAW_INT, SYS_STATUS, RADIO_STATUS (out 1Hz 模拟)
  - PARAM_REQUEST_LIST  -> 一系列 PARAM_VALUE
  - PARAM_REQUEST_READ  -> 单个 PARAM_VALUE
  - PARAM_SET           -> 广播 PARAM_VALUE 确认
  - COMMAND_LONG(MAV_CMD_SET_MESSAGE_INTERVAL) -> COMMAND_ACK
"""
import socket, struct, time, math, base64, os, hashlib, re, threading, sys

# MAVLink v2 CRC (CRC-16/CCITT-FALSE 反射 = MCRF4XX, polynomial 0x8408)
# 与 mavlink/c_library_v2/checksum.h 一致, 与 QGC/PX4 c_library 一致
# 之前的 0xA001 是 CRC-16/IBM/MODBUS, 与 MAVLink 不兼容 (飞控会静默丢弃)
CRC_TABLE = []
for i in range(256):
    crc = i
    for _ in range(8):
        crc = (crc >> 1) ^ 0x8408 if crc & 1 else crc >> 1
    CRC_TABLE.append(crc)

# CRC extra 表 (MAVLink common message set, 与 src/mavlink.js 保持一致)
# 取自 mavlink/c_library_v2/common/mavlink_msg_*.h
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
    """MAVLink CRC-16/MCRF4XX 计算.
    与 pymavlink/dialects/common.py 的 x25() 一致, 最后一步用 crc_extra (不是 0xFF).
    调用方传入 [1, 10+len) — 即跳过 STX (buf[0])."""
    crc = 0xFFFF
    for i in range(start, end):
        tmp = (crc ^ buf[i]) & 0xFF
        crc = (crc >> 8) ^ CRC_TABLE[tmp]
    # MAVLink final byte: 用 msg-specific crc_extra (不是固定 0xFF)
    tmp = (crc ^ (crc_extra & 0xFF)) & 0xFF
    crc = (crc >> 8) ^ CRC_TABLE[tmp]
    return crc & 0xFFFF

def build_frame(msgid, sysid, compid, seq, payload, crc_extra=None):
    """Build MAVLink v2 frame.
    msgid 24-bit LITTLE-ENDIAN (per MAVLink v2 spec & pymavlink)
    CRC 范围: 跳过 STX, 算 header(9 bytes) + payload(len bytes)
    """
    if crc_extra is None:
        crc_extra = CRC_EXTRA.get(msgid, 0)
    # msgid 24-bit LSB-first (pymavlink: msgid = data[7] | (data[8]<<8) | (data[9]<<16))
    hdr = bytes([0xFD, len(payload) & 0xFF, 0, 0, seq & 0xFF, sysid & 0xFF, compid & 0xFF,
                 msgid & 0xFF, (msgid >> 8) & 0xFF, (msgid >> 16) & 0xFF])
    body = hdr + payload
    # MAVLink CRC 跳过 STX (body[0]), 算 [body[1] .. body[10+len])
    crc = crc_x25(body, 1, 10 + len(payload), crc_extra)
    return body + bytes([crc & 0xFF, (crc >> 8) & 0xFF])

def parse_frame(data):
    """Parse a single MAVLink v2 frame; return (msgid, sysid, compid, seq, payload) or None.
    参考 mavlink_parse_char (qgroundcontrol/src/comm/mavlink/protocol/mavlink_helpers.h)
    CRC 范围: 跳过 STX, 算 [data[1] .. data[10+len])"""
    if len(data) < 12 or data[0] != 0xFD: return None
    plen = data[1]
    incompat = data[2]
    compat = data[3]
    seq = data[4]
    sysid = data[5]
    compid = data[6]
    # msgid 24-bit LITTLE-ENDIAN
    msgid = data[7] | (data[8] << 8) | (data[9] << 16)
    if incompat & 0x01:  # MAVLINK_IFLAG_SIGNED
        return None  # signed frames not supported in mock
    total = 10 + plen + 2
    if len(data) < total: return None
    payload = bytes(data[10:10+plen])
    crc_extra = CRC_EXTRA.get(msgid, 0)
    crc_calc = crc_x25(data, 1, 10 + plen, crc_extra)
    crc_got = data[10+plen] | (data[10+plen+1] << 8)
    if crc_calc != crc_got: return None
    return msgid, sysid, compid, seq, payload, total


# =================== Mock parameter store ===================
# 模拟 PX4 参数 (挑选 ~31 个有代表性的, 含多种 MAV_PARAM_TYPE)
MAV_PARAM_TYPE = {
    'REAL32': 1, 'REAL64': 2, 'INT8': 3, 'UINT8': 4,
    'INT16': 5, 'UINT16': 6, 'INT32': 7, 'UINT32': 8,
}

def value_to_union(value, ptype):
    """把实际值按 param_type 写入 mavlink_param_union_t 后取 float32 位模式.
    参考 QGC _sendParamSetToVehicle / PX4 param.c (param_set 先 union 再 wire).
    param_value 线上是 float32, 但整型参数必须按类型放位, 否则飞控拒收."""
    try:
        if ptype == MAV_PARAM_TYPE['INT8']:
            return struct.unpack('<f', struct.pack('<b', int(value)) + b'\x00\x00\x00')[0]
        if ptype == MAV_PARAM_TYPE['UINT8']:
            return struct.unpack('<f', struct.pack('<B', int(value) & 0xFF) + b'\x00\x00\x00')[0]
        if ptype == MAV_PARAM_TYPE['INT16']:
            return struct.unpack('<f', struct.pack('<h', int(value)) + b'\x00\x00')[0]
        if ptype == MAV_PARAM_TYPE['UINT16']:
            return struct.unpack('<f', struct.pack('<H', int(value) & 0xFFFF) + b'\x00\x00')[0]
        if ptype == MAV_PARAM_TYPE['INT32']:
            return struct.unpack('<f', struct.pack('<i', int(value)))[0]
        if ptype == MAV_PARAM_TYPE['UINT32']:
            return struct.unpack('<f', struct.pack('<I', int(value) & 0xFFFFFFFF))[0]
    except (struct.error, ValueError, OverflowError):
        pass
    # REAL32 / REAL64 / 未知 → 直接按 float
    return float(value)

def union_to_value(float_bits, ptype):
    """把线上的 float32 位模式按 param_type 解释成实际值 (mavlink_param_union_t).
    参考 QGC ParameterManager::mavlinkMessageReceived (paramUnion.param_float -> typed member)."""
    raw = struct.pack('<f', float_bits)
    if ptype == MAV_PARAM_TYPE['INT8']:
        return struct.unpack('<b', raw[0:1])[0]
    if ptype == MAV_PARAM_TYPE['UINT8']:
        return raw[0]
    if ptype == MAV_PARAM_TYPE['INT16']:
        return struct.unpack('<h', raw[0:2])[0]
    if ptype == MAV_PARAM_TYPE['UINT16']:
        return struct.unpack('<H', raw[0:2])[0]
    if ptype == MAV_PARAM_TYPE['INT32']:
        return struct.unpack('<i', raw[0:4])[0]
    if ptype == MAV_PARAM_TYPE['UINT32']:
        return struct.unpack('<I', raw[0:4])[0]
    # REAL32 / REAL64 / 未知
    return float_bits

def build_default_params():
    P = MAV_PARAM_TYPE
    return [
        (b'SYS_AUTOSTART\x00\x00\x00\x00\x00\x00',     1001, P['INT32']),
        (b'SYS_AUTOCONFIG\x00\x00\x00\x00\x00\x00',        1, P['INT32']),
        (b'SYS_RESTART_TYPE\x00\x00\x00\x00',              0, P['INT32']),
        (b'MC_PITCHRATE_P\x00\x00\x00\x00\x00',          0.15, P['REAL32']),
        (b'MC_PITCHRATE_I\x00\x00\x00\x00\x00',          0.05, P['REAL32']),
        (b'MC_PITCHRATE_D\x00\x00\x00\x00\x00',        0.0025, P['REAL32']),
        (b'MC_ROLLRATE_P\x00\x00\x00\x00\x00',           0.15, P['REAL32']),
        (b'MC_ROLLRATE_I\x00\x00\x00\x00\x00',           0.05, P['REAL32']),
        (b'MC_YAWRATE_P\x00\x00\x00\x00\x00',            0.20, P['REAL32']),
        (b'MPC_XY_P\x00\x00\x00\x00\x00\x00\x00',        0.95, P['REAL32']),
        (b'MPC_XY_VEL_P\x00\x00\x00\x00\x00',            0.10, P['REAL32']),
        (b'MPC_XY_VEL_I\x00\x00\x00\x00\x00',            0.02, P['REAL32']),
        (b'MPC_XY_VEL_D\x00\x00\x00\x00\x00',            0.01, P['REAL32']),
        (b'MPC_Z_P\x00\x00\x00\x00\x00\x00\x00',         1.00, P['REAL32']),
        (b'MPC_Z_VEL_P\x00\x00\x00\x00\x00',             0.20, P['REAL32']),
        (b'MPC_Z_VEL_I\x00\x00\x00\x00\x00',             0.02, P['REAL32']),
        (b'MPC_Z_VEL_D\x00\x00\x00\x00\x00',             0.00, P['REAL32']),
        (b'COM_DISARM_LAND\x00\x00\x00',                   2, P['INT32']),
        (b'COM_DL_LOSS_T\x00\x00\x00\x00',                10, P['INT32']),
        (b'IFSC_DIST_SW\x00\x00\x00\x00',                  0, P['INT32']),
        (b'COM_RC_LOSS_T\x00\x00\x00\x00',                10, P['INT32']),
        (b'COM_RC_IN_MODE\x00\x00\x00\x00',                1, P['INT32']),
        (b'BAT_CAPACITY\x00\x00\x00\x00\x00',           3000, P['INT32']),
        (b'BAT_N_CELLS\x00\x00\x00\x00\x00',               4, P['INT32']),
        (b'BAT_V_CHARGED\x00\x00\x00\x00',              4.05, P['REAL32']),
        (b'BAT_V_EMPTY\x00\x00\x00\x00\x00',             3.50, P['REAL32']),
        (b'GPS_TYPE\x00\x00\x00\x00\x00\x00\x00',          1, P['INT32']),
        (b'GF_MAX_HOR_DIST\x00\x00\x00',                  50, P['INT32']),
        (b'GF_FENCE_DIST\x00\x00\x00\x00',                 0, P['INT32']),
        (b'NAV_ACC_RAD\x00\x00\x00\x00\x00',              10, P['INT32']),
        (b'NAV_DLL_ACT\x00\x00\x00\x00\x00\x00',           0, P['INT32']),
    ]

PARAMS = build_default_params()


def msg_param_value(seq, sysid, compid, name_bytes, value, ptype, count, index):
    # PARAM_VALUE = 22. 线上布局与 mavlink C 库 mavlink_msg_param_value_pack 一致:
    #   param_value(f)@0 + param_count(H)@4 + param_index(H)@6 + param_id(z16)@8 + param_type(B)@24
    # 注意: param_value 按类型做 union 位转换 (整型参数在线上是它的位模式, 不是数值本身)。
    float_bits = value_to_union(value, ptype)
    payload = struct.pack('<fHH', float_bits, count, index) + name_bytes[:16].ljust(16, b'\x00') + struct.pack('<B', ptype)
    return build_frame(22, sysid, compid, seq, payload)

def msg_command_ack(seq, sysid, compid, command, result):
    # COMMAND_ACK = 77: command(H) + result(B)
    payload = struct.pack('<HB', command, result)
    return build_frame(77, sysid, compid, seq, payload)

def msg_heartbeat(seq, sysid, compid, armed):
    custom_mode = (4 << 16)
    # HEARTBEAT = 9 bytes. C 库线上布局: custom_mode(I)@0 + type(B)@4 + autopilot(B)@5 + base_mode(B)@6 + system_status(B)@7 + mavlink_version(B)@8
    payload = struct.pack('<IBBBBB', custom_mode, 2, 12, 0x81 if armed else 0x01, 4, 3)
    return build_frame(0, sysid, compid, seq, payload)

def msg_attitude(seq, roll, pitch, yaw):
    # ATTITUDE = 28 bytes: I + 6f
    return build_frame(30, 1, 1, seq, struct.pack('<I6f', 1000, roll, pitch, yaw, 0.01, 0.02, 0))

def msg_global_pos(seq, lat, lon, alt, rel_alt, vx, vy, vz, hdg):
    # GLOBAL_POSITION_INT = 28 bytes: I + 4*i + 3*h + H
    return build_frame(33, 1, 1, seq, struct.pack('<IiiiihhhH', 1000, lat, lon, alt, rel_alt, vx, vy, vz, hdg))

def msg_gps(seq, fix, lat, lon, alt, eph, sats):
    # GPS_RAW_INT (min 30 bytes): Q + 3*i + 4*H + B + B
    return build_frame(24, 1, 1, seq, struct.pack('<QiiiHHHHBB', 0, lat, lon, alt, eph, 999, 0, 0, fix, sats))

def msg_sys_status(seq, voltage_mv, current_ca, remaining):
    # SYS_STATUS = 31 bytes: 3*I + 11*H + b
    payload = struct.pack('<III', 0, 0, 0)                          # present, enabled, health
    payload += struct.pack('<HH', 500, voltage_mv)                 # load, voltage_battery
    payload += struct.pack('<h', current_ca)                       # current_battery (i16)
    payload += struct.pack('<HHHHHH', 0, 0, 0, 0, 0, 0)           # drop, errors, err1, err2, err3, err4
    payload += struct.pack('<b', remaining)                        # battery_remaining (i8)
    return build_frame(1, 1, 1, seq, payload)

def msg_radio(seq, rssi):
    # RADIO_STATUS = 9 bytes. C 库线上布局: rxerrors(H)@0 + fixed(H)@2 + rssi(B)@4 + remrssi(B)@5 + txbuf(B)@6 + noise(B)@7 + remnoise(B)@8
    return build_frame(109, 1, 1, seq, struct.pack('<HHBBBBB', 0, 0, rssi, rssi, 100, 50, 50))


# ---------- WebSocket server ----------
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

def ws_decode_frame(data):
    """Decode one client -> server WebSocket frame; return (opcode, payload) or None"""
    if len(data) < 2: return None
    b1, b2 = data[0], data[1]
    opcode = b1 & 0x0F
    masked = (b2 & 0x80) != 0
    length = b2 & 0x7F
    idx = 2
    if length == 126:
        if len(data) < 4: return None
        length = (data[2] << 8) | data[3]
        idx = 4
    elif length == 127:
        if len(data) < 10: return None
        length = int.from_bytes(data[2:10], 'big')
        idx = 10
    if masked:
        if len(data) < idx + 4: return None
        mask = data[idx:idx+4]
        idx += 4
    if len(data) < idx + length: return None
    payload = data[idx:idx+length]
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload, idx + length

def ws_encode_frame(payload, opcode=0x2):
    """Encode server -> client WebSocket binary frame"""
    b1 = 0x80 | (opcode & 0x0F)
    if len(payload) < 126:
        header = bytes([b1, len(payload) & 0x7F])
    elif len(payload) < 65536:
        header = bytes([b1, 126]) + struct.pack('>H', len(payload))
    else:
        header = bytes([b1, 127]) + struct.pack('>Q', len(payload))
    return header + payload


def handle_client(conn, addr, state):
    try:
        print(f"Client connected from {addr}", flush=True)
        # 1. HTTP→WebSocket Upgrade 握手 (RFC 6455)
        # 等待直到读到完整的 \r\n\r\n
        handshake_buf = b''
        conn.settimeout(10)
        while b'\r\n\r\n' not in handshake_buf:
            chunk = conn.recv(4096)
            if not chunk:
                raise ConnectionError('client closed during handshake')
            handshake_buf += chunk
            if len(handshake_buf) > 8192:
                raise ConnectionError('handshake too large')
        # 提取 Sec-WebSocket-Key
        try:
            head_str = handshake_buf.split(b'\r\n\r\n', 1)[0].decode('latin-1', errors='replace')
        except Exception:
            head_str = ''
        m = re.search(r'Sec-WebSocket-Key:\s*([A-Za-z0-9+/=]+)', head_str, re.IGNORECASE)
        if not m:
            # 不是合法的 WS 握手, 关闭连接
            conn.sendall(b'HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n')
            raise ConnectionError('not a websocket handshake')
        client_key = m.group(1).strip()
        accept = base64.b64encode(
            hashlib.sha1((client_key + WS_GUID).encode()).digest()
        ).decode()
        handshake_resp = (
            'HTTP/1.1 101 Switching Protocols\r\n'
            'Upgrade: websocket\r\n'
            'Connection: Upgrade\r\n'
            f'Sec-WebSocket-Accept: {accept}\r\n\r\n'
        )
        conn.sendall(handshake_resp.encode())
        # 剩余字节 (客户端可能已经在握手中后发送了 WS 帧)
        leftover = handshake_buf.split(b'\r\n\r\n', 1)[1]
        print(f"[WS] Handshake OK from {addr}, key={client_key[:16]}...", flush=True)

        state['clients'].append(conn)
        client_state = {
            'rx_buf': b'',
            'gcs_sysid': 255,
            'gcs_compid': 190,
            'sent_params': False,
        }
        state['client_states'][conn] = client_state
        conn.settimeout(60)
        while True:
            try:
                data = conn.recv(4096)
                if not data: break
                leftover += data
                while leftover:
                    r = ws_decode_frame(leftover)
                    if r is None: break
                    op, payload, off = r
                    leftover = leftover[off:]
                    if op == 0x8:  # close
                        raise ConnectionError('close')
                    if op == 0x2 or op == 0x0:
                        process_mavlink_bytes(payload, conn, state, client_state)
                    if op == 0x9:  # ping
                        # 回应 pong
                        s = state['seq'][0]; state['seq'][0] = (s + 1) & 0xFF
                        conn.sendall(ws_encode_frame(payload, opcode=0xA))
            except (ConnectionError, socket.timeout):
                break
    except Exception as e:
        print(f"Client {addr} error: {e}")
    finally:
        try: conn.close()
        except: pass
        if conn in state['clients']:
            state['clients'].remove(conn)
            print(f"Client {addr} disconnected")
        if conn in state['client_states']:
            del state['client_states'][conn]


def process_mavlink_bytes(data, conn, state, client_state):
    """解析客户端发来的 MAVLink 帧并按需响应"""
    client_state['rx_buf'] += data
    # 逐帧解析
    while client_state['rx_buf']:
        # 跳到 0xFD
        idx = client_state['rx_buf'].find(b'\xFD')
        if idx < 0:
            client_state['rx_buf'] = b''
            break
        if idx > 0:
            client_state['rx_buf'] = client_state['rx_buf'][idx:]
        r = parse_frame(client_state['rx_buf'])
        if r is None: break
        msgid, sysid, compid, seq, payload, total = r
        client_state['rx_buf'] = client_state['rx_buf'][total:]
        # 记录 GCS sysid/compid 以便回包时填 src
        client_state['gcs_sysid'] = sysid
        client_state['gcs_compid'] = compid
        handle_incoming(msgid, sysid, compid, payload, conn, state, client_state)


def handle_incoming(msgid, sysid, compid, payload, conn, state, client_state):
    """处理客户端发来的特定消息"""
    if msgid == 0:  # HEARTBEAT
        pass
    elif msgid == 21:  # PARAM_REQUEST_LIST
        # payload: target_system(B) target_component(B)
        tgt_sys = payload[0]
        tgt_comp = payload[1]
        print(f"[PARAM] PARAM_REQUEST_LIST from GCS sys={sysid} for tgt sys={tgt_sys} comp={tgt_comp}, sending {len(PARAMS)} params", flush=True)
        # 按 20ms 间隔发送 PARAM_VALUE (避免 burst/TCP 合并)
        def send_all():
            s = state['seq'][0]
            count = len(PARAMS)
            sent_count = 0
            for i, (name_b, val, ptype) in enumerate(PARAMS):
                try:
                    f = msg_param_value(s, 1, 1, name_b, val, ptype, count, i)
                    broadcast(state, bytes(f))
                    sent_count += 1
                    s = (s + 1) & 0xFF
                    time.sleep(0.01)  # 10ms 间隔 (TCP_NODELAY 下不会合并)
                except Exception as e:
                    print(f"[PARAM] send {i} err: {e}", flush=True)
                    break
            state['seq'][0] = s
            client_state['sent_params'] = True
            print(f"[PARAM] sent {sent_count}/{len(PARAMS)} params", flush=True)
        threading.Thread(target=send_all, daemon=True).start()
    elif msgid == 20:  # PARAM_REQUEST_READ
        # C 库线上布局: param_index(h)@0 + target_system(B)@2 + target_component(B)@3 + param_id(z16)@4
        idx = struct.unpack('<h', payload[0:2])[0]
        tgt_sys = payload[2]
        tgt_comp = payload[3]
        name = payload[4:20].rstrip(b'\x00').decode('ascii', errors='ignore')
        if idx == -1 or idx == 65535:
            # by name
            for i, (n, v, t) in enumerate(PARAMS):
                if n.rstrip(b'\x00').decode('ascii', errors='ignore') == name:
                    s = state['seq'][0]; state['seq'][0] = (s + 1) & 0xFF
                    f = msg_param_value(s, 1, 1, n, v, t, len(PARAMS), i)
                    broadcast(state, bytes(f))
                    break
        else:
            if 0 <= idx < len(PARAMS):
                n, v, t = PARAMS[idx]
                s = state['seq'][0]; state['seq'][0] = (s + 1) & 0xFF
                f = msg_param_value(s, 1, 1, n, v, t, len(PARAMS), idx)
                broadcast(state, bytes(f))
    elif msgid == 23:  # PARAM_SET
        # C 库线上布局: param_value(f)@0 + target_system(B)@4 + target_component(B)@5 + param_id(z16)@6 + param_type(B)@22
        float_bits = struct.unpack('<f', payload[0:4])[0]
        tgt_sys = payload[4]
        tgt_comp = payload[5]
        name = payload[6:22].rstrip(b'\x00').decode('ascii', errors='ignore')
        ptype = payload[22]
        # 关键: param_value 是 union 位模式, 必须按 param_type 解释 (真实 PX4 param.c 行为)
        val = union_to_value(float_bits, ptype)
        # 写参数 + 广播确认
        new_params = []
        found = False
        idx = -1
        for i, (n, v, t) in enumerate(PARAMS):
            if n.rstrip(b'\x00').decode('ascii', errors='ignore') == name:
                new_params.append((n, val, ptype if ptype else t))
                found = True
                idx = i
            else:
                new_params.append((n, v, t))
        if found:
            PARAMS[:] = new_params
            print(f"[PARAM] PARAM_SET {name} = {val} (type={ptype}, union_bits={float_bits!r})", flush=True)
            # PX4 通过 param_index=0xFFFF (PARAM_INVALID) 的广播确认写入
            s = state['seq'][0]; state['seq'][0] = (s + 1) & 0xFF
            f = msg_param_value(s, 1, 1, name.encode('ascii').ljust(16, b'\x00'), val,
                                ptype if ptype else PARAMS[idx][2], len(PARAMS), 0xFFFF)
            broadcast(state, bytes(f))
    elif msgid == 76:  # COMMAND_LONG
        # C 库线上布局: param1..7(f)@0..27 + command(H)@28 + target_system(B)@30 + target_component(B)@31 + confirmation(B)@32
        command = struct.unpack('<H', payload[28:30])[0]
        if command == 511:  # MAV_CMD_SET_MESSAGE_INTERVAL
            s = state['seq'][0]; state['seq'][0] = (s + 1) & 0xFF
            ack = msg_command_ack(s, 1, 1, 511, 0)  # MAV_RESULT_ACCEPTED
            broadcast(state, bytes(ack))
            print(f"[CMD] SET_MESSAGE_INTERVAL ACK sent")
        elif command == 245:  # MAV_CMD_PREFLIGHT_STORAGE
            param1 = struct.unpack('<f', payload[0:4])[0]
            if param1 == 2:
                # 重置所有参数为固件默认值
                PARAMS[:] = build_default_params()
                print(f"[CMD] PREFLIGHT_STORAGE: 所有参数已重置为固件默认值", flush=True)
            s = state['seq'][0]; state['seq'][0] = (s + 1) & 0xFF
            broadcast(state, bytes(msg_command_ack(s, 1, 1, 245, 0)))
            print(f"[CMD] PREFLIGHT_STORAGE ACK sent")
        elif command == 246:  # MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN
            param1 = struct.unpack('<f', payload[0:4])[0]
            if param1 == 1:
                print(f"[CMD] REBOOT: 模拟飞控重启 (重置参数缓存)", flush=True)
                PARAMS[:] = build_default_params()
            s = state['seq'][0]; state['seq'][0] = (s + 1) & 0xFF
            broadcast(state, bytes(msg_command_ack(s, 1, 1, 246, 0)))
            print(f"[CMD] REBOOT_SHUTDOWN ACK sent")


def broadcast(state, payload):
    """向所有已连接 client 广播一帧 MAVLink.  加锁防止并发交错. """
    dead = []
    frame = ws_encode_frame(payload, 0x2)
    with state['send_lock']:
        if state.get('debug', False):
            msgid = payload[7] | (payload[8] << 8) | (payload[9] << 16)
            print(f"[BCAST] msgid={msgid} len={len(payload)} to {len(state['clients'])} client(s)", flush=True)
        for c in list(state['clients']):  # list() 防止迭代时修改
            try:
                c.sendall(frame)
            except Exception:
                dead.append(c)
    for c in dead:
        try: c.close()
        except: pass
        if c in state['clients']: state['clients'].remove(c)


def main():
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('0.0.0.0', 8766))
    sock.listen(5)
    sock.settimeout(0.5)
    print("Mock MAVLink server on ws://0.0.0.0:8766")

    # 自检: 解码自己生成的 HEARTBEAT 帧
    hb = msg_heartbeat(0, 1, 1, True)
    att = msg_attitude(1, 0.123, -0.045, 1.57)
    gp = msg_global_pos(2, 302741000, 1201551000, 22000, 21500, 500, -300, 100, 18000)
    gps = msg_gps(3, 3, 302741000, 1201551000, 22000, 120, 14)
    sys_s = msg_sys_status(4, 22300, 1800, 85)
    radio = msg_radio(5, 92)

    print("=== SELF-TEST (decode own frames) ===")
    print(f"  HEARTBEAT hex:    {' '.join(f'{b:02x}' for b in hb)}")
    print(f"  HEARTBEAT crc check: {crc_x25(hb, 1, len(hb)-2, 50):04x} == {hb[-2] | (hb[-1]<<8):04x} ? {crc_x25(hb, 1, len(hb)-2, 50) == (hb[-2] | (hb[-1]<<8))}")
    print(f"  ATTITUDE hex:     {' '.join(f'{b:02x}' for b in att)}")
    print(f"  GLOBAL_POS hex:   {' '.join(f'{b:02x}' for b in gp)}")
    print(f"  GPS_RAW hex:      {' '.join(f'{b:02x}' for b in gps)}")
    print(f"  SYS_STATUS hex:   {' '.join(f'{b:02x}' for b in sys_s)}")
    print(f"  RADIO hex:        {' '.join(f'{b:02x}' for b in radio)}")
    # PARAM_VALUE self-test
    pv = msg_param_value(7, 1, 1, b'SYS_AUTOSTART\x00\x00\x00\x00\x00\x00', 1001, MAV_PARAM_TYPE['INT32'], 31, 0)
    print(f"  PARAM_VALUE hex:  {' '.join(f'{b:02x}' for b in pv)}")
    pv_parsed = parse_frame(pv)
    if pv_parsed:
        mid, _, _, _, pld, _ = pv_parsed
        float_bits = struct.unpack('<f', pld[0:4])[0]
        count = struct.unpack('<H', pld[4:6])[0]
        idx = struct.unpack('<H', pld[6:8])[0]
        name = pld[8:24].rstrip(b'\x00').decode('ascii')
        ptype = pld[24]
        val = union_to_value(float_bits, ptype)
        print(f"  PARAM_VALUE parsed: name={name} val={val} type={ptype} count={count} idx={idx}")
        assert val == 1001, f"SELF-TEST FAIL: INT32 union roundtrip {val} != 1001"
    # COMMAND_ACK self-test
    ack = msg_command_ack(8, 1, 1, 511, 0)
    ack_parsed = parse_frame(ack)
    if ack_parsed:
        mid, _, _, _, pld, _ = ack_parsed
        cmd, result = struct.unpack('<HB', pld[:3])
        print(f"  COMMAND_ACK parsed: cmd={cmd} result={result}")
    print("=== SERVER READY ===")

    state = {'clients': [], 'client_states': {}, 'seq': [0], 'send_lock': threading.Lock(), 'debug': False}
    seq = state['seq']
    t0 = time.time()

    def tick_loop():
        while True:
            time.sleep(0.1)
            if not state['clients']: continue
            t = time.time() - t0
            roll  = math.sin(t * 0.5) * 0.25
            pitch = math.sin(t * 0.4) * 0.18
            yaw   = (t * 0.15) % (2 * math.pi)
            lat = int((30.2741 + math.cos(t * 0.2) * 0.0004) * 1e7)
            lon = int((120.1551 + math.sin(t * 0.2) * 0.0004) * 1e7)
            alt = int(22000 + math.sin(t * 0.4) * 3000)
            rel = int(21500 + math.sin(t * 0.4) * 3000)
            vx = int(math.cos(t * 0.2) * 500)
            vy = int(math.sin(t * 0.2) * 500)
            vz = int(math.sin(t * 0.4) * 100)
            hdg = int(((yaw * 180 / math.pi + 360) % 360) * 100)
            armed = t > 2
            frames = []
            f = msg_heartbeat(seq[0], 1, 1, armed); seq[0] = (seq[0]+1) & 0xFF; frames.append(f)
            f = msg_attitude(seq[0], roll, pitch, yaw); seq[0] = (seq[0]+1) & 0xFF; frames.append(f)
            f = msg_global_pos(seq[0], lat, lon, alt, rel, vx, vy, vz, hdg); seq[0] = (seq[0]+1) & 0xFF; frames.append(f)
            f = msg_gps(seq[0], 3, lat, lon, alt, 120, 14); seq[0] = (seq[0]+1) & 0xFF; frames.append(f)
            f = msg_sys_status(seq[0], 22300, 1800, max(20, 90 - int(t/10))); seq[0] = (seq[0]+1) & 0xFF; frames.append(f)
            f = msg_radio(seq[0], 92); seq[0] = (seq[0]+1) & 0xFF; frames.append(f)
            for fr in frames:
                broadcast(state, bytes(fr))

    t = threading.Thread(target=tick_loop, daemon=True)
    t.start()

    try:
        while True:
            try:
                c, a = sock.accept()
                # 关闭 Nagle, 避免小 WS 帧被合并 (WS 一帧对应一 MAVLink 帧)
                c.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except socket.timeout:
                continue
            th = threading.Thread(target=handle_client, args=(c, a, state), daemon=True)
            th.start()
    except KeyboardInterrupt:
        print("Shutting down...")
        sock.close()


if __name__ == "__main__":
    main()