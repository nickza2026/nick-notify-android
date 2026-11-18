# ตั้งอุปกรณ์เป็นเงียบจากหน้าเว็บ — สัญญาสำหรับ Dashboard

> เอกสารนี้อธิบายเฉพาะส่วนที่เพิ่มจาก [บัญชีเดียว หลายอุปกรณ์](fe-shared-devices-th.md) ยังไม่ยืนยันว่า production เปิดใช้แล้ว และไม่ใช่ผลทดสอบเสียงบนมือถือจริง

## สิ่งที่เปลี่ยน

- ทะเบียนอุปกรณ์มี field ใหม่ `silent` (boolean) — ค่าเริ่มต้น `false` ทุกเครื่องเดิมยังมีเสียงเหมือนก่อน
- เพิ่ม `PATCH /api/devices/{device_id}` เพื่อเปิด/ปิดโหมดเงียบรายเครื่อง
- เครื่องที่ `silent: true` จะได้รับเหตุการณ์ **ใหม่ทุกระดับเป็นข้อความเท่านั้น** (เหมือน `normal`): ไม่มีเสียงด่วน ไม่มีเสียงปลุกวนของวิกฤต เครื่องอื่นในบัญชีไม่ได้รับผลกระทบ
- ประวัติ (`importance` ใน history/detail) ยังเป็นระดับที่ระบบส่งขอ ไม่เปลี่ยนเป็น `normal` เพราะเครื่องหนึ่งเงียบ
- ไม่มีผลย้อนหลัง: เสียงที่เริ่มแล้วบนเครื่องต้องกดรับทราบบนเครื่องนั้นเอง และเหตุการณ์ที่กระจายก่อนบันทึกค่าจะใช้ค่าเดิม
- APK รุ่นเก่าที่ไม่รู้จัก `notice` จะข้ามเหตุการณ์ของเครื่องที่ตั้งเงียบไปทั้งหมด (ไม่แสดง ไม่ดัง) จนกว่าจะอัปเดต APK

## ภาพรวม UI และ Information Architecture

- **Navigation**: หน้าเดิม `/devices` (ตารางอุปกรณ์) ไม่มีหน้าใหม่ เพิ่มคอลัมน์ "เสียงบนเครื่องนี้"
- **Endpoint → UI**: `GET /api/devices` เติมตาราง; สวิตช์ในแต่ละแถวเรียก `PATCH /api/devices/{device_id}`; ปุ่มเดิม "ยกเลิกการรับ" ยังใช้ `DELETE`
- **Permission → action**: full Dashboard session เท่านั้น (สิทธิ์เดียวกับดู/ยกเลิกอุปกรณ์) ไม่มีสิทธิ์ย่อยเพิ่ม
- **UX**:
  - เปลี่ยนจากมีเสียง → เงียบ ต้องยืนยันก่อน เพราะทำให้วิกฤตไม่ปลุกเครื่องนั้น; เปลี่ยนกลับเป็นมีเสียงไม่ต้องยืนยัน
  - ระหว่างส่งคำขอปิดการกดสวิตช์/ปุ่มอื่น ไม่เปลี่ยนสถานะในตารางก่อน server ยืนยัน แล้วใช้ค่าใน response แทนค่าที่กด
  - เครื่องที่ `active: false` ยังตั้งค่าได้ (มีผลเมื่อเครื่องกลับมาลงทะเบียน)
  - ล้มเหลว/timeout: แสดงข้อความว่าไม่ทราบผลและให้รีเฟรช ไม่ลองซ้ำอัตโนมัติ
- **Handoff checklist**
  - [ ] response เก่าที่ไม่มี `silent` แสดงเป็น "มีเสียง" ไม่ error
  - [ ] ยืนยันก่อนตั้งเงียบ และแจ้งว่ามีผลกับวิกฤตด้วย
  - [ ] แสดงค่าจาก response หลัง `PATCH` ไม่ใช่ค่าที่ผู้ใช้กด
  - [ ] ไม่แสดง FCM token หรือ field อื่นที่ไม่ได้อยู่ในตาราง Key reference

## `PATCH /api/devices/{device_id}`

Browser เรียก same-origin BFF: cookie session + `Origin` ตรงหน้าเว็บ + `Content-Type: application/json` + `X-Notify-Request: dashboard` (BFF ส่งต่อไป `PATCH /v1/dashboard/devices/{device_id}` พร้อม application key และ `X-Dashboard-Session`; browser ห้ามเรียก Go ตรง)

`device_id` ต้องเป็น UUID จาก `GET /api/devices` ห้ามมี query string

### Request (example JSON)

```json
{
  "silent": true
}
```

| Field | Change |
|---|---|
| `silent` | **ใหม่** — บังคับ |

### Key reference (Request)

| Key | Meaning |
|---|---|
| `silent` | `true` = เหตุการณ์ใหม่ทุกระดับแสดงเป็นข้อความเท่านั้นบนเครื่องนี้; `false` = ระดับด่วน/วิกฤตมีเสียงตามปกติ ต้องเป็น boolean จริง ห้าม `null`/string และห้ามมี key อื่น (ได้ 400 `invalid_schema`) |

### Response (example JSON)

HTTP 200 — ทะเบียนอุปกรณ์หลังบันทึก รูปเดียวกับ `items[]` ของ `GET /api/devices`

```json
{
  "device_id": "22222222-2222-4222-8222-222222222222",
  "installation_id": "11111111-1111-4111-8111-111111111111",
  "device_name": "เครื่องจำลองหนึ่ง",
  "key_ids": ["primary"],
  "active": true,
  "silent": true,
  "created_at": "2026-11-08T09:00:00Z",
  "updated_at": "2026-11-08T10:00:00Z"
}
```

| Field | Change |
|---|---|
| `silent` | **ใหม่** — boolean; ค่าที่ server บันทึกจริง |
| อื่น ๆ | ไม่เปลี่ยนจาก `GET /api/devices` |

### Key reference (Response)

| Key | Meaning |
|---|---|
| `device_id` | UUID ของทะเบียน ตรงกับ path |
| `installation_id` | UUID การติดตั้งแอป ไม่ใช่ hardware ID |
| `device_name` | ชื่อแสดงผล อาจซ้ำกันได้ |
| `key_ids` | public key IDs ที่ผูก ห้ามใช้เป็น Bearer |
| `active` | ลงทะเบียนรับรายการใหม่หรือไม่ ไม่ใช่สถานะออนไลน์ |
| `silent` | **ใหม่** — เครื่องนี้ตั้งเงียบอยู่หรือไม่ |
| `created_at` | UTC เวลาสร้างทะเบียน |
| `updated_at` | UTC เวลาอัปเดตทะเบียนล่าสุด — **การตั้งเงียบไม่เปลี่ยนค่านี้** |

### ข้อผิดพลาด

| HTTP / code | การรับมือ |
|---|---|
| 400 `invalid_schema` | body ไม่ใช่ `{"silent": boolean}` หรือ `device_id` ไม่ใช่ UUID |
| 401 `session_required` | ไปหน้า login |
| 403 `password_change_required` / `invalid_origin` | เปลี่ยนรหัส / ไม่ retry |
| 404 `device_not_found` | ไม่พบอุปกรณ์ในบัญชี ให้รีเฟรชรายการ |
| 502 / 503 | ไม่ทราบผล ให้รีเฟรชตรวจค่าก่อนลองใหม่ (BFF ตอบ 502 ถ้า server ไม่ยืนยันค่า `silent` ตามที่ขอ) |

## `GET /api/devices` — field ใหม่ใน response

```json
{
  "items": [
    {
      "device_id": "22222222-2222-4222-8222-222222222222",
      "installation_id": "11111111-1111-4111-8111-111111111111",
      "device_name": "เครื่องจำลองหนึ่ง",
      "key_ids": ["primary"],
      "active": true,
      "silent": false,
      "created_at": "2026-11-08T09:00:00Z",
      "updated_at": "2026-11-08T10:00:00Z"
    }
  ]
}
```

| Field | Change |
|---|---|
| `items[].silent` | **ใหม่** — boolean; server รุ่นก่อนไม่มี field นี้ ให้ถือเป็น `false` |

### Key reference (Response)

| Key | Meaning |
|---|---|
| `items` | ทะเบียนในบัญชี |
| `items[].device_id` | UUID ใช้กับ `PATCH`/`DELETE` |
| `items[].installation_id` | UUID การติดตั้ง |
| `items[].device_name` | ชื่อแสดงผล |
| `items[].key_ids` | public key IDs |
| `items[].active` | ลงทะเบียนรับรายการใหม่หรือไม่ |
| `items[].silent` | **ใหม่** — เครื่องนี้ตั้งเงียบอยู่หรือไม่ |
| `items[].created_at`, `items[].updated_at` | UTC timestamps ของทะเบียน |

## ผลต่อ FCM payload (ข้อมูลสำหรับผู้ดูแล ไม่ใช่งาน FE)

สำหรับเครื่อง `silent: true` server ส่ง `type=notice` และ `importance=normal` (FCM priority `NORMAL`) แทนระดับจริง ส่วน `alert_id`, `ack_url`, `ack_token` ของเครื่องยังเหมือนเดิม จึงรับทราบและ sync ประวัติได้ตามปกติ
