// mavlink.js — MAVLink v2 解析器 (PX4 子集, 支持 HEARTBEAT/ATTITUDE/GPS/POS/BATTERY/FTP)
//
// 帧格式 (MAVLink v2):
//   0xFD  len  inc_flags  cmp_flags  seq  sysid  compid  msgid(3)  payload[len]  crc[2]
//
// 字段类型代码:
//   B = uint8 (1)   b = int8 (1)
//   H = uint16 (2)  h = int16 (2)
//   I = uint32 (4)  i = int32 (4)
//   Q = uint64 (8)  q = int64 (8)
//   f = float (4)   d = double (8)
//   z = null-terminated string
//   a[N] = raw bytes array

const MAV_STX = 0xFD;
const MAV_STX_V1 = 0xFE;
const MAV_STX_V9 = 0x55;  // MAVLink 0.9 (极老固件, 部分飞控默认)

export const MAVLINK_IFLAG_SIGNED = 0x01;

// -------- CRC 计算 (MAVLink CRC-16/CCITT-FALSE, 反射 = 0x8408) --------
// 重要: MAVLink 官方 (c_library checksum.h) 用的是 MCRF4XX 算法
//   polynomial 0x1021 反射后 = 0x8408 (CRC-16/CCITT 反射, 即 KERMIT/MCRF4XX)
// 之前的 0xA001 是 CRC-16/IBM/MODBUS, 跟 MAVLink 不兼容
// 验证: HEARTBEAT [09 00 ff be 00 06 08 c0 00 00 00 00 04 03] crc_extra=50
//   0xA001 -> 0xC53D (飞控收到后用 0x8408 算 = 0x5A98, 不匹配, 飞控拒收 -> 飞控不响应)
//   0x8408 -> 0x5A98 (与 QGC/PX4 c_library 一致)
const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >>> 1) ^ 0x8408;
      else crc = crc >>> 1;
    }
    table[i] = crc;
  }
  return table;
})();

export function mavlinkCrc(buf, start, end, crcExtra) {
  let crc = 0xFFFF;
  for (let i = start; i < end; i++) {
    const tmp = (crc ^ buf[i]) & 0xFF;
    crc = (crc >>> 8) ^ CRC_TABLE[tmp];
  }
  // MAVLink final byte: crc_extra byte XOR
  const tmp = ((crc ^ (crcExtra || 0)) & 0xFF);
  crc = (crc >>> 8) ^ CRC_TABLE[tmp];
  return crc & 0xFFFF;
}

// -------- 消息定义 (PX4 常用子集) --------
// 每个消息的 crc_extra 取自 mavlink/c_library_v2/common/mavlink_msg_*.h
// (此值不是固定的 0xFF, 是每条消息末尾独有的 byte)
export const MSG = {
  // 注意: 字段顺序 = MAVLink C 库的"线上布局"(mavgen 会把标量字段按大小重排、char 数组靠后),
  // 不是 XML 声明顺序。见 mavlink_msg_heartbeat.h 的 pack 函数:
  //   custom_mode(I)@0 + type(B)@4 + autopilot(B)@5 + base_mode(B)@6 + system_status(B)@7 + mavlink_version(B)@8
  HEARTBEAT:           { id: 0,   name: 'HEARTBEAT',           crcExtra: 50,  fields: [
    { n: 'custom_mode',      t: 'I' }, { n: 'type',            t: 'B' },
    { n: 'autopilot',        t: 'B' }, { n: 'base_mode',       t: 'B' },
    { n: 'system_status',    t: 'B' }, { n: 'mavlink_version',  t: 'B' },
  ]},
  SYS_STATUS:          { id: 1,   name: 'SYS_STATUS',          crcExtra: 124, fields: [
    { n: 'onboard_control_sensors_present', t: 'I' },
    { n: 'onboard_control_sensors_enabled',  t: 'I' },
    { n: 'onboard_control_sensors_health',  t: 'I' },
    { n: 'load',            t: 'H' },
    { n: 'voltage_battery', t: 'H' },
    { n: 'current_battery', t: 'h' },
    { n: 'drop_rate_comm',  t: 'H' },
    { n: 'errors_comm',     t: 'H' },
    { n: 'errors_count1',   t: 'H' },
    { n: 'errors_count2',   t: 'H' },
    { n: 'errors_count3',   t: 'H' },
    { n: 'errors_count4',   t: 'H' },
    { n: 'battery_remaining', t: 'b' },
  ]},
  GPS_RAW_INT:         { id: 24,  name: 'GPS_RAW_INT',         crcExtra: 24,  fields: [
    { n: 'time_usec',       t: 'Q' }, { n: 'lat',              t: 'i' },
    { n: 'lon',              t: 'i' }, { n: 'alt',              t: 'i' },
    { n: 'eph',              t: 'H' }, { n: 'epv',              t: 'H' },
    { n: 'vel',              t: 'H' }, { n: 'cog',              t: 'H' },
    { n: 'fix_type',         t: 'B' }, { n: 'satellites_visible', t: 'B' },
  ]},
  ATTITUDE:            { id: 30,  name: 'ATTITUDE',            crcExtra: 39,  fields: [
    { n: 'time_boot_ms',    t: 'I' }, { n: 'roll',             t: 'f' },
    { n: 'pitch',           t: 'f' }, { n: 'yaw',              t: 'f' },
    { n: 'rollspeed',       t: 'f' }, { n: 'pitchspeed',       t: 'f' },
    { n: 'yawspeed',        t: 'f' },
  ]},
  GLOBAL_POSITION_INT: { id: 33,  name: 'GLOBAL_POSITION_INT', crcExtra: 104, fields: [
    { n: 'time_boot_ms',    t: 'I' }, { n: 'lat',              t: 'i' },
    { n: 'lon',              t: 'i' }, { n: 'alt',              t: 'i' },
    { n: 'relative_alt',    t: 'i' }, { n: 'vx',               t: 'h' },
    { n: 'vy',               t: 'h' }, { n: 'vz',               t: 'h' },
    { n: 'hdg',              t: 'H' },
  ]},
  VFR_HUD:             { id: 74,  name: 'VFR_HUD',             crcExtra: 20,  fields: [
    // C 库线上布局 (mavgen 4 字节对齐, 见 mavlink_msg_vfr_hud.h pack 函数):
    //   airspeed(f)@0 + groundspeed(f)@4 + alt(f)@8 + climb(f)@12
    //   + heading(h)@16 + throttle(H)@18, 总长 20 字节
    // 注意: alt 在 climb 之前 (mavgen 按字节对齐重排, 非 XML 声明顺序)
    // 参考 QGC Vehicle::_handleVfrHud: 空速/地速/爬升率/油门/高度
    { n: 'airspeed',   t: 'f' }, { n: 'groundspeed', t: 'f' },
    { n: 'alt',        t: 'f' }, { n: 'climb',       t: 'f' },
    { n: 'heading',    t: 'h' }, { n: 'throttle',    t: 'H' },
  ]},
  RC_CHANNELS_RAW:     { id: 35,  name: 'RC_CHANNELS_RAW',     crcExtra: 244, fields: [
    { n: 'time_boot_ms', t: 'I' },
    { n: 'chan1_raw', t: 'H' }, { n: 'chan2_raw', t: 'H' },
    { n: 'chan3_raw', t: 'H' }, { n: 'chan4_raw', t: 'H' },
    { n: 'chan5_raw', t: 'H' }, { n: 'chan6_raw', t: 'H' },
    { n: 'chan7_raw', t: 'H' }, { n: 'chan8_raw', t: 'H' },
    { n: 'rssi', t: 'B' },
  ]},
  COMMAND_ACK:         { id: 77,  name: 'COMMAND_ACK',         crcExtra: 143, fields: [
    { n: 'command', t: 'H' },
    { n: 'result',  t: 'B' },
  ]},
  COMMAND_LONG:       { id: 76,  name: 'COMMAND_LONG',        crcExtra: 152, fields: [
    // C 库线上布局: param1..7(f)@0..27 + command(H)@28 + target_system(B)@30 + target_component(B)@31 + confirmation(B)@32
    { n: 'param1',           t: 'f' },
    { n: 'param2',           t: 'f' },
    { n: 'param3',           t: 'f' },
    { n: 'param4',           t: 'f' },
    { n: 'param5',           t: 'f' },
    { n: 'param6',           t: 'f' },
    { n: 'param7',           t: 'f' },
    { n: 'command',          t: 'H' },
    { n: 'target_system',    t: 'B' },
    { n: 'target_component', t: 'B' },
    { n: 'confirmation',     t: 'B' },
  ]},
  RADIO_STATUS:        { id: 109, name: 'RADIO_STATUS',        crcExtra: 185, fields: [
    // C 库线上布局: rxerrors(H)@0 + fixed(H)@2 + rssi(B)@4 + remrssi(B)@5 + txbuf(B)@6 + noise(B)@7 + remnoise(B)@8
    { n: 'rxerrors', t: 'H' }, { n: 'fixed', t: 'H' },
    { n: 'rssi', t: 'B' }, { n: 'remrssi', t: 'B' }, { n: 'txbuf', t: 'B' },
    { n: 'noise', t: 'B' }, { n: 'remnoise', t: 'B' },
  ]},
  FILE_TRANSFER_PROTOCOL: { id: 110, name: 'FILE_TRANSFER_PROTOCOL', crcExtra: 84, fields: [
    { n: 'target_network', t: 'B' }, { n: 'target_system', t: 'B' },
    { n: 'target_component', t: 'B' }, { n: 'payload', t: 'a[251]' },
  ]},
  // ---- Parameter protocol (MAVLink common) ----
  // Reference: mavlink/c_library_v2/common/mavlink_msg_PARAM_*.h
  // 注意: 三个参数消息的线上布局都是"标量在前、param_id(z16) 靠后",
  //   与 XML 声明顺序 (param_id 第一) 不同 — 必须按 C 库 pack 函数的偏移写字段定义!
  PARAM_REQUEST_READ: { id: 20,  name: 'PARAM_REQUEST_READ',  crcExtra: 214, fields: [
    // C 库: param_index(h)@0 + target_system(B)@2 + target_component(B)@3 + param_id(z16)@4
    { n: 'param_index', t: 'h' },
    { n: 'target_system', t: 'B' },
    { n: 'target_component', t: 'B' },
    { n: 'param_id', t: 'z16' },     // 16 字节, 不足补 0
  ]},
  PARAM_REQUEST_LIST: { id: 21,  name: 'PARAM_REQUEST_LIST',  crcExtra: 159, fields: [
    { n: 'target_system', t: 'B' },
    { n: 'target_component', t: 'B' },
  ]},
  PARAM_VALUE:        { id: 22,  name: 'PARAM_VALUE',         crcExtra: 220, fields: [
    // C 库: param_value(f)@0 + param_count(H)@4 + param_index(H)@6 + param_id(z16)@8 + param_type(B)@24
    // 之前按 XML 顺序 (param_id 第一) 定义, 真实 PX4 帧会被错位解码 → 参数名/值乱码
    { n: 'param_value', t: 'f' },
    { n: 'param_count', t: 'H' },
    { n: 'param_index', t: 'H' },
    { n: 'param_id', t: 'z16' },     // 16 字节, null padded
    { n: 'param_type', t: 'B' },
  ]},
  PARAM_SET:          { id: 23,  name: 'PARAM_SET',           crcExtra: 168, fields: [
    // C 库: param_value(f)@0 + target_system(B)@4 + target_component(B)@5 + param_id(z16)@6 + param_type(B)@22
    { n: 'param_value', t: 'f' },
    { n: 'target_system', t: 'B' },
    { n: 'target_component', t: 'B' },
    { n: 'param_id', t: 'z16' },
    { n: 'param_type', t: 'B' },
  ]},
  HOME_POSITION:       { id: 242, name: 'HOME_POSITION',       crcExtra: 104, fields: [
    { n: 'latitude',  t: 'i' }, { n: 'longitude', t: 'i' }, { n: 'altitude', t: 'i' },
    { n: 'x', t: 'f' }, { n: 'y', t: 'f' }, { n: 'z', t: 'f' },
    { n: 'approach_x', t: 'f' }, { n: 'approach_y', t: 'f' }, { n: 'approach_z', t: 'f' },
    { n: 'time_usec', t: 'Q' },
  ]},
  ALTITUDE:             { id: 141, name: 'ALTITUDE',             crcExtra: 47,  fields: [
    { n: 'altitude_monotonic', t: 'f' }, { n: 'altitude_amsl', t: 'f' },
    { n: 'altitude_local', t: 'f' }, { n: 'altitude_relative', t: 'f' },
    { n: 'altitude_terrain', t: 'f' }, { n: 'bottom_clearance', t: 'f' },
    { n: 'time_usec', t: 'Q' },
  ]},
  STATUSTEXT:          { id: 253, name: 'STATUSTEXT',          crcExtra: 83,  fields: [
    { n: 'severity', t: 'B' }, { n: 'text', t: 'z' },
  ]},
};

const _byId = {};
for (const k of Object.keys(MSG)) _byId[MSG[k].id] = { ...MSG[k], key: k };
export function msgById(id) { return _byId[id]; }

// -------- 字段解码 --------
// 消息声明的固定长度 (变长 z 字段计 0, 不参与补齐)
function declaredLen(msgDef) {
  let n = 0;
  for (const f of msgDef.fields) {
    if (f.t === 'z') continue;
    if (f.t === 'z16') { n += 16; continue; }
    if (f.t === 'a[251]') { n += 251; continue; }
    n += szOf(f.t);
  }
  return n;
}

function decodeFields(msgDef, buf) {
  // MAVLink v2 发送端会把 payload 尾部的零字节截掉 (mavlink_helpers.h 的 _mav_trim_payload,
  // 至少保留 1 字节)。C 库解码前先按完整长度清零再 memcpy 实际字节
  // (见 mavlink_msg_param_value_decode: memset(...,0,LEN); memcpy(...,payload,len)),
  // 缺失的尾部字节自动补 0。这里同样补齐, 否则短 payload 会让字段偏移错位、
  // 越界读抛错 → 整条消息被 try/catch 静默丢弃 (参数列表就少了参数)。
  const declared = declaredLen(msgDef);
  if (buf.length < declared) {
    const padded = new Uint8Array(declared);
    padded.set(buf);
    buf = padded;
  }
  const out = { _msgid: msgDef.id, _name: msgDef.name };
  let off = 0;
  for (const f of msgDef.fields) {
    if (f.t === 'z') {
      let end = off;
      while (end < buf.length && buf[end] !== 0) end++;
      out[f.n] = new TextDecoder().decode(buf.slice(off, end));
      off = end + 1;
    } else if (f.t === 'z16') {
      // 16 字节定长, 不足补 0 — 截掉尾部 \0 后解码
      let end = Math.min(off + 16, buf.length);
      while (end > off && buf[end - 1] === 0) end--;
      out[f.n] = new TextDecoder().decode(buf.slice(off, end));
      off += 16;
    } else if (f.t === 'a[251]') {
      out[f.n] = new Uint8Array(buf.slice(off, off + 251));
      off += 251;
    } else {
      out[f.n] = decodeScalar(f.t, buf, off);
      off += szOf(f.t);
    }
  }
  return out;
}
function decodeScalar(t, buf, off) {
  switch (t) {
    case 'B': return buf[off] & 0xFF;
    case 'b': {
      const v = buf[off];
      return v & 0x80 ? v - 0x100 : v;
    }
    case 'i': {
      const dv = new DataView(buf.buffer, buf.byteOffset + off, 4);
      return dv.getInt32(0, true);
    }
    case 'I': {
      const dv = new DataView(buf.buffer, buf.byteOffset + off, 4);
      return dv.getUint32(0, true);
    }
    case 'f': {
      const dv = new DataView(buf.buffer, buf.byteOffset + off, 4);
      return dv.getFloat32(0, true);
    }
    case 'h': {
      const dv = new DataView(buf.buffer, buf.byteOffset + off, 2);
      return dv.getInt16(0, true);
    }
    case 'H': {
      const dv = new DataView(buf.buffer, buf.byteOffset + off, 2);
      return dv.getUint16(0, true);
    }
    case 'Q': {
      const dv = new DataView(buf.buffer, buf.byteOffset + off, 8);
      return dv.getBigUint64(0, true);
    }
  }
  return 0;
}
function szOf(t) {
  switch (t) {
    case 'B': case 'b': return 1;
    case 'H': case 'h': return 2;
    case 'I': case 'i': case 'f': return 4;
    case 'Q': case 'q': return 8;
    case 'd': return 8;
  }
  return 0;
}

// -------- 参数协议 union 位转换 (mavlink_param_union_t) --------
// MAVLink PARAM_VALUE/PARAM_SET 的 param_value 字段是 4 字节 union:
//   PX4/QGC 用 mavlink_param_union_t (float/int32/uint32/int16/uint16/int8/uint8 共用内存),
//   线上只传 4 字节位模式, 由 param_type 决定如何解释。
//   参考 QGC ParameterManager.cc: 解码时 paramUnion.param_float=param_value 后按 type 读;
//   编码时按 type 写入 union 成员再取 param_float (bit-cast)。
//   之前这里直接把数值当 float32 收发 → 整型参数写错位模式被 PX4 拒绝 / 显示乱码。
export const MAV_PARAM_TYPE = {
  REAL32: 1, REAL64: 2, INT8: 3, UINT8: 4,
  INT16: 5, UINT16: 6, INT32: 7, UINT32: 8,
  INT64: 9, UINT64: 10,
};

const _paramUnionDv = new DataView(new ArrayBuffer(4));

/** 把线上 float32 位模式按 param_type 解释为有类型数值 (QGC paramUnion 解码) */
export function paramValueToNumber(floatBits, type) {
  _paramUnionDv.setFloat32(0, floatBits, true);
  switch (type) {
    case MAV_PARAM_TYPE.UINT8:  return _paramUnionDv.getUint8(0);
    case MAV_PARAM_TYPE.INT8:   return _paramUnionDv.getInt8(0);
    case MAV_PARAM_TYPE.UINT16: return _paramUnionDv.getUint16(0, true);
    case MAV_PARAM_TYPE.INT16:  return _paramUnionDv.getInt16(0, true);
    case MAV_PARAM_TYPE.UINT32: return _paramUnionDv.getUint32(0, true) >>> 0;
    case MAV_PARAM_TYPE.INT32:  return _paramUnionDv.getInt32(0, true);
    case MAV_PARAM_TYPE.INT64:  return Number(BigInt.asIntN(64, BigInt(_paramUnionDv.getUint32(0, true))));
    case MAV_PARAM_TYPE.UINT64: return Number(BigInt.asUintN(64, BigInt(_paramUnionDv.getUint32(0, true))));
    default: return floatBits;  // REAL32 / REAL64 (线上无 8 字节字段, 退化为 float)
  }
}

/** 把有类型数值按 param_type 写成线上 float32 位模式 (QGC paramUnion 编码) */
export function numberToParamUnion(value, type) {
  const t = Number(value) || 0;
  switch (type) {
    case MAV_PARAM_TYPE.UINT8:  _paramUnionDv.setUint8(0, t & 0xff); break;
    case MAV_PARAM_TYPE.INT8:   _paramUnionDv.setInt8(0, t | 0); break;
    case MAV_PARAM_TYPE.UINT16: _paramUnionDv.setUint16(0, t & 0xffff, true); break;
    case MAV_PARAM_TYPE.INT16:  _paramUnionDv.setInt16(0, t | 0, true); break;
    case MAV_PARAM_TYPE.UINT32: _paramUnionDv.setUint32(0, t >>> 0, true); break;
    case MAV_PARAM_TYPE.INT32:  _paramUnionDv.setInt32(0, t | 0, true); break;
    case MAV_PARAM_TYPE.INT64:
    case MAV_PARAM_TYPE.UINT64:
      // 线上 param_value 只有 4 字节, 高 32 位丢失 (与 QGC C union 一致)
      _paramUnionDv.setUint32(0, Number(BigInt.asUintN(32, BigInt(Math.trunc(t)))) >>> 0, true); break;
    default: _paramUnionDv.setFloat32(0, t, true); break;  // REAL32 / REAL64 退化
  }
  return _paramUnionDv.getFloat32(0, true);
}

// -------- 字段编码 --------
function encodeFields(msgDef, values) {
  const parts = [];
  for (const f of msgDef.fields) {
    if (f.t === 'z') {
      const s = values[f.n] || '';
      parts.push(new TextEncoder().encode(s + '\0'));
    } else if (f.t === 'z16') {
      // 16 字节定长, 不足补 0
      const s = values[f.n] || '';
      const enc = new TextEncoder().encode(s);
      const buf = new Uint8Array(16);
      buf.set(enc.slice(0, 16));
      parts.push(buf);
    } else if (f.t === 'a[251]') {
      const arr = values[f.n] || new Uint8Array(251);
      parts.push(arr.slice(0, 251));
    } else {
      parts.push(encodeScalar(f.t, values[f.n]));
    }
  }
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
function encodeScalar(t, v) {
  const sz = szOf(t);
  const buf = new Uint8Array(sz);
  const dv = new DataView(buf.buffer);
  switch (t) {
    case 'B': buf[0] = (v | 0) & 0xff; break;
    case 'b': buf[0] = (v | 0) & 0xff; break;
    case 'i': dv.setInt32(0, (v | 0), true); break;
    case 'I': dv.setUint32(0, (v >>> 0), true); break;
    case 'f': dv.setFloat32(0, Number(v) || 0, true); break;
    case 'h': dv.setInt16(0, (v | 0), true); break;
    case 'H': dv.setUint16(0, (v | 0) & 0xffff, true); break;
    case 'Q': dv.setBigUint64(0, BigInt(v), true); break;
  }
  return buf;
}

// -------- 流式解析器 --------
export class MAVLinkParser {
  constructor() {
    this.buffer = new Uint8Array(4096);
    this.length = 0;
    this.onMessage = null;
    this.onRaw = null;
    // 解析统计 (看门狗/诊断用): bytes=收到的字节, frames=解析的 v2 帧, crcFail=CRC 失败, delivered=成功交付, unknown=未知消息
    this.stats = { bytes: 0, frames: 0, crcFail: 0, delivered: 0, unknown: 0 };
  }
  push(chunk) {
    if (chunk.length === 0) return;
    if (this.length + chunk.length > this.buffer.length) {
      const nb = new Uint8Array(Math.max(this.length + chunk.length, this.buffer.length * 2));
      nb.set(this.buffer.subarray(0, this.length));
      this.buffer = nb;
    }
    this.buffer.set(chunk, this.length);
    this.length += chunk.length;
    this.stats.bytes += chunk.length;
    if (this.onRaw) this.onRaw(chunk);

    // 诊断: 累计 0xFD/0xFE/0x55 出现次数, 帮助确认飞控协议版本
    this._dbgCount = (this._dbgCount || 0) + chunk.length;
    const _dbgLastReport = this._dbgLastReport || 0;
    if (this._dbgCount - _dbgLastReport >= 100 || this._dbgCount < 50) {
      let fd = 0, fe = 0, f55 = 0;
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i];
        if (b === 0xFD) fd++;
        else if (b === 0xFE) fe++;
        else if (b === 0x55) f55++;
      }
      this._dbgFD = (this._dbgFD || 0) + fd;
      this._dbgFE = (this._dbgFE || 0) + fe;
      this._dbgF55 = (this._dbgF55 || 0) + f55;
      if (this.onDebug && this._dbgCount < 1000) {
        this.onDebug(`RX 累计 ${this._dbgCount}B: STX 0xFD=${this._dbgFD} 0xFE=${this._dbgFE} 0x55=${this._dbgF55}`);
      }
      this._dbgLastReport = this._dbgCount;
    }

    let off = 0;
    while (this.length - off >= 8) {
      const b = this.buffer[off];
      if (b === MAV_STX) {
        const len = this.buffer[off + 1];
        const incompat = this.buffer[off + 2];
        const seq = this.buffer[off + 4];
        const sysid = this.buffer[off + 5];
        const compid = this.buffer[off + 6];
        // MAVLink v2 msgid 24-bit LITTLE-ENDIAN: off+7=LSB, off+8=mid, off+9=MSB
        const msgid = this.buffer[off + 7] | (this.buffer[off + 8] << 8) | (this.buffer[off + 9] << 16);
        // incompat_flags bit 0 = SIGNED, 末尾带 13 字节 signature
        const isSigned = (incompat & 0x01) !== 0;
        const sigLen = isSigned ? 13 : 0;
        const frameLen = 10 + len + 2 + sigLen;
        if (this.length - off < frameLen) break;

        const payload = this.buffer.slice(off + 10, off + 10 + len);
        const crcLo = this.buffer[off + 10 + len];
        const crcHi = this.buffer[off + 10 + len + 1];
        const crcRx = (crcHi << 8) | crcLo;

        const def = msgById(msgid);
        // MAVLink CRC: 跳过 STX (off+0), 算 [off+1 .. off+10+len), 最后一步 crc_extra
        const crcCalc = mavlinkCrc(this.buffer, off + 1, off + 10 + len, def ? def.crcExtra : 0);
        const ok = (crcCalc === crcRx);
        this.stats.frames++;

        // 诊断: 每个 v2 帧都打印
        if (this.onDebug && this._dbgCount < 2000) {
          this.onDebug(`V2 msgid=${msgid} len=${len} sysid=${sysid} compid=${compid} CRC rx=0x${crcRx.toString(16).padStart(4,'0')} calc=0x${crcCalc.toString(16).padStart(4,'0')} ${ok ? '✓' : '✗'}${def ? '' : ' (未知消息)'}`);
        }

        if (ok) {
          if (def) {
            this.stats.delivered++;
            try {
              const parsed = decodeFields(def, payload);
              parsed._sysid = sysid; parsed._compid = compid; parsed._seq = seq;
              parsed._v2 = true;
              parsed._signed = isSigned;
              parsed._ok = true;
              if (this.onMessage) this.onMessage(parsed);
            } catch (e) {}
          } else {
            this.stats.unknown++;
          }
          off += frameLen;  // CRC ok: 跳到下个 frame
        } else {
          this.stats.crcFail++;
          off++;             // CRC fail: 重同步到下个字节 (防止跳过 payload 里的 0xFD/0xFE)
        }
      } else if (b === MAV_STX_V1) {
        // MAVLink v1 帧: STX(1) + len(1) + seq(1) + sysid(1) + compid(1) + msgid(1) + payload(len) + crc(2)
        // 总长 = 6 + len + 2
        const len = this.buffer[off + 1];
        const seq = this.buffer[off + 2];
        const sysid = this.buffer[off + 3];
        const compid = this.buffer[off + 4];
        const msgid = this.buffer[off + 5];
        const frameLen = 6 + len + 2;
        if (this.length - off < frameLen) break;

        const payload = this.buffer.slice(off + 6, off + 6 + len);
        const crcLo = this.buffer[off + 6 + len];
        const crcHi = this.buffer[off + 6 + len + 1];
        const crcRx = (crcHi << 8) | crcLo;

        const def = msgById(msgid);
        // MAVLink v1 CRC: 跳过 STX (off+0), 算 [off+1 .. off+6+len), 最后一步 crc_extra
        const crcCalc = mavlinkCrc(this.buffer, off + 1, off + 6 + len, def ? def.crcExtra : 0);
        const ok = (crcCalc === crcRx);

        // 诊断: 每个 v1 帧都打印 (CRC ok 也会打印)
        if (this.onDebug && this._dbgCount < 2000) {
          this.onDebug(`V1 msgid=${msgid} len=${len} sysid=${sysid} compid=${compid} CRC rx=0x${crcRx.toString(16).padStart(4,'0')} calc=0x${crcCalc.toString(16).padStart(4,'0')} ${ok ? '✓' : '✗'}${def ? '' : ' (未知消息)'}`);
        }

        if (ok) {
          if (def) {
            try {
              const parsed = decodeFields(def, payload);
              parsed._sysid = sysid; parsed._compid = compid; parsed._seq = seq;
              parsed._v1 = true;
              parsed._ok = true;
              if (this.onMessage) this.onMessage(parsed);
            } catch (e) {}
          }
          off += frameLen;  // CRC ok: 跳到下个 frame
        } else {
          off++;             // CRC fail: 重同步到下个字节
        }
      } else if (b === MAV_STX_V9) {
        // MAVLink 0.9 帧: STX(0x55) + len + seq + sysid + compid + msgid + payload(len) + crc(2)
        // 总长 = 6 + len + 2  (与 v1 同结构, 仅 STX 不同)
        const len = this.buffer[off + 1];
        const seq = this.buffer[off + 2];
        const sysid = this.buffer[off + 3];
        const compid = this.buffer[off + 4];
        const msgid = this.buffer[off + 5];
        const frameLen = 6 + len + 2;
        if (this.length - off < frameLen) break;

        const payload = this.buffer.slice(off + 6, off + 6 + len);
        const crcLo = this.buffer[off + 6 + len];
        const crcHi = this.buffer[off + 6 + len + 1];
        const crcRx = (crcHi << 8) | crcLo;

        const def = msgById(msgid);
        // MAVLink 0.9 CRC: 跳过 STX, 算 [off+1 .. off+6+len), 最后一步 crc_extra
        const crcCalc = mavlinkCrc(this.buffer, off + 1, off + 6 + len, def ? def.crcExtra : 0);
        const ok = (crcCalc === crcRx);

        if (ok) {
          if (def) {
            try {
              const parsed = decodeFields(def, payload);
              parsed._sysid = sysid; parsed._compid = compid; parsed._seq = seq;
              parsed._v9 = true;
              parsed._ok = true;
              if (this.onMessage) this.onMessage(parsed);
            } catch (e) {}
          }
          off += frameLen;  // CRC ok: 跳到下个 frame
        } else {
          off++;             // CRC fail: 重同步到下个字节
        }
      } else {
        off++;
      }
    }
    if (off > 0) {
      this.buffer.copyWithin(0, off, this.length);
      this.length -= off;
    }
  }
}

// -------- 编码一帧 --------
// 默认 MAVLink v2 帧 (PX4/ArduPilot 现代固件都支持 v2, 而且 GCS_HEARTBEAT 收到的 MAVLink v2 帧需要 v2 响应)
// v2 帧: STX(1) + len(1) + incompat(1) + compat(1) + seq(1) + sysid(1) + compid(1) + msgid(3) + payload(len) + crc(2)  =  12 + len
// v1 仅在 compat 场景使用 (forceV1=true), msgid 范围 0..255
export function encodeFrame(msgDef, sysid, compid, seq, values, forceV1 = false) {
  const payload = encodeFields(msgDef, values);
  const len = payload.length;
  // 默认 v2, msgid > 255 必须 v2
  const useV2 = !forceV1;

  if (useV2) {
    // MAVLink v2 帧: 10 + len + 2
    const header = new Uint8Array(10);
    header[0] = MAV_STX;
    header[1] = len & 0xff;
    header[2] = 0; // incompat_flags
    header[3] = 0; // compat_flags
    header[4] = seq & 0xff;
    header[5] = sysid & 0xff;
    header[6] = compid & 0xff;
    // msgid 24-bit LITTLE-ENDIAN (per MAVLink v2 spec & pymavlink)
    header[7] = msgDef.id & 0xff;          // LSB
    header[8] = (msgDef.id >> 8) & 0xff;
    header[9] = (msgDef.id >> 16) & 0xff;  // MSB
    const body = new Uint8Array(header.length + payload.length + 2);
    body.set(header, 0);
    body.set(payload, header.length);
    // MAVLink v2 CRC: 跳过 STX (body[0]), 算 [body[1] .. body[10+len]), 最后一步 crc_extra
    const crc = mavlinkCrc(body, 1, 1 + 9 + len, msgDef.crcExtra);
    body[header.length + payload.length] = crc & 0xff;
    body[header.length + payload.length + 1] = (crc >> 8) & 0xff;
    return body;
  } else {
    // MAVLink v1 帧: 6 + len + 2
    const header = new Uint8Array(6);
    header[0] = MAV_STX_V1;
    header[1] = len & 0xff;
    header[2] = seq & 0xff;
    header[3] = sysid & 0xff;
    header[4] = compid & 0xff;
    header[5] = msgDef.id & 0xff;
    const body = new Uint8Array(header.length + payload.length + 2);
    body.set(header, 0);
    body.set(payload, header.length);
    // MAVLink v1 CRC: 跳过 STX (body[0]), 算 [body[1] .. body[6+len]), 最后一步 crc_extra
    const crc = mavlinkCrc(body, 1, 1 + 5 + len, msgDef.crcExtra);
    body[header.length + payload.length] = crc & 0xff;
    body[header.length + payload.length + 1] = (crc >> 8) & 0xff;
    return body;
  }
}

// -------- MAVLink FTP 协议 (mftp://) --------
// opcode 数值严格按 mavlink.io/en/services/ftp.html 定义
// 客户端请求: opcode=命令码, req_opcode=命令码 (填相同值)
// 飞控响应: opcode=128(ACK) 或 129(NAK), req_opcode=原请求命令码
export const FTP_OP = {
  NONE:             0,
  TERM_SESSION:     1,   // 关闭 session
  RESET_SESSION:    2,   // 重置所有 session
  LIST_DIRECTORY:   3,   // 列出目录
  OPEN_FILE_RO:     4,   // 打开文件读
  READ_FILE:        5,   // 读文件
  CREATE_FILE:      6,
  WRITE_FILE:       7,
  REMOVE_FILE:      8,
  CREATE_DIRECTORY: 9,
  REMOVE_DIRECTORY: 10,
  OPEN_FILE_WO:     11,
  TRUNCATE_FILE:    12,
  RENAME:           13,
  CALC_FILE_CRC32:  14,
  BURST_READ_FILE:  15,  // 突发读 (大文件用)
  ACK:              128, // 飞控响应: ACK
  NAK:              129, // 飞控响应: NAK
};
export const FTP_ERR = {
  NONE:              0,
  FAIL:              1,
  FAIL_ERRNO:        2,
  INVALID_DATA_SIZE: 3,
  INVALID_SESSION:   4,
  NO_SESSIONS:       5,
  EOF:               6,   // 列表/读取结束
  UNKNOWN_COMMAND:   7,
  FILE_EXISTS:       8,
  FILE_PROTECTED:    9,
  FILE_NOT_FOUND:    10,
};

export function decodeFTPPayload(payload) {
  // payload 布局 (按 mavlink.io/en/services/ftp.html):
  //   0-1: seq_number (uint16_t)
  //   2:   session    (uint8_t)
  //   3:   opcode     (uint8_t)
  //   4:   size       (uint8_t)  - 不是 4 字节!
  //   5:   req_opcode (uint8_t)
  //   6:   burst_complete (uint8_t)
  //   7:   padding    (uint8_t)
  //   8-11: offset    (uint32_t)
  //   12-251: data     (240 字节, 实际有效数据长度 = size 字段)
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    seq_number: dv.getUint16(0, true),
    session:    dv.getUint8(2),
    opcode:     dv.getUint8(3),
    size:       dv.getUint8(4),          // 1 字节
    req_opcode: dv.getUint8(5),
    burst_complete: dv.getUint8(6),
    padding:    dv.getUint8(7),
    offset32:   dv.getUint32(8, true),   // 从 offset 8 开始
    data:       new Uint8Array(payload.slice(12, 12 + dv.getUint8(4))),  // 按 size 截取
  };
}
// MAVLink FILE_TRANSFER_PROTOCOL MAVLink 消息:
//   整个消息 payload = 3 字节 (target_network/system/component) + 251 字节 FTP 子协议
//   MAVLINK_MSG_ID_FILE_TRANSFER_PROTOCOL_LEN = 254 (PX4 解析器只接受完整 254 字节)
//   飞控收到 len < 254 的 FILE_TRANSFER_PROTOCOL 会直接丢弃, 不回响应 (造成 FTP 超时)
//
// FTP 子协议 payload (251 字节) 内部布局:
//   0-1:  seq_number  (uint16 LE)
//   2:    session     (uint8)
//   3:    opcode      (uint8) - 命令码 (请求) 或 ACK(128)/NAK(129) (响应)
//   4:    size        (uint8) - data 字段有效字节数 (0..239)
//   5:    req_opcode  (uint8) - 请求时填 0; 响应时填被响应的命令码
//   6:    burst_complete (uint8)
//   7:    padding     (uint8)
//   8-11: offset      (uint32 LE)
//   12-250: data      (239 字节, 实际有效长度 = size 字段)
export function encodeFTPPayload(p) {
  const buf = new Uint8Array(251);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, p.seq_number || 0, true);
  buf[2] = p.session || 0;
  buf[3] = p.opcode || 0;
  buf[4] = p.size & 0xFF;
  buf[5] = p.req_opcode || 0;     // 请求时填 0, 响应时填 opcode
  buf[6] = p.burst_complete || 0;
  buf[7] = p.padding || 0;
  if (p.offset32 != null) dv.setUint32(8, p.offset32 >>> 0, true);
  if (p.dataStr) {
    const s = new TextEncoder().encode(p.dataStr + '\0');
    buf.set(s.slice(0, 239), 12);       // data 从 offset 12 开始, 最多 239 字节
  } else if (p.data) {
    buf.set(p.data.slice(0, 239), 12);
  }
  return buf;
}