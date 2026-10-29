# Dashboard authentication และการส่งทดสอบ — Frontend contract

ขอบเขต: Web ผู้ดูแลหนึ่งบัญชี ไม่มี public signup เส้นทาง/DTO ด้านล่างตรงกับ mounted browser API รุ่น login ไม่ใช่คำยืนยันว่า production ถูกอัปเดตแล้ว

## 1. Endpoint inventory

Browser เรียกเฉพาะ same-origin routes ต่อไปนี้ ไม่เรียก Go โดยตรงและไม่รับ application API key หรือ Ack capability

| Method/path | การเปลี่ยนแปลง | ใช้เมื่อ | ผู้เรียก / contract |
|---|---|---|---|
| `POST /api/auth/login` | ใหม่ | ส่ง username/password | anonymous · [ข้อ 3](#login) |
| `GET /api/auth/session` | ใหม่ | ตรวจ session และสถานะบังคับเปลี่ยนรหัส | restricted/full session · [ข้อ 4](#session) |
| `POST /api/auth/change-password` | ใหม่ | เปลี่ยนรหัสครั้งแรกหรือเปลี่ยนระหว่างใช้งาน | restricted/full session · [ข้อ 5](#change-password) |
| `POST /api/auth/logout` | ใหม่ | ออกจากระบบ | session; รองรับไม่มี/หมดอายุ · [ข้อ 6](#logout) |
| `GET /api/history` | เปลี่ยน permission | ดูประวัติ ต้องผ่านการเปลี่ยนรหัสครั้งแรกแล้ว | full session · [ข้อ 7](#history) |
| `GET /api/stats` | เปลี่ยน permission | ภาพรวมตามช่วงวันที่ | full session · [ข้อ 8](#stats) |
| `GET /api/alerts/{id}` | เปลี่ยน permission | รายละเอียดและ Ack timeline | full session · [ข้อ 9](#detail) |
| `POST /api/test-alerts` | ใหม่ | ส่งการแจ้งเตือนทดสอบไปอุปกรณ์ที่ server ตั้งไว้ | full session · [ข้อ 11](#test-alerts) |

จากเดิมที่อนุญาตเฉพาะ localhost เป็น canonical Web origin + session authentication ไม่ใช่เปิด anonymous ทุก host DTO/query ของสาม read routes ยังคงเดิม แต่ FE ต้องรองรับ session หมดอายุและบังคับเปลี่ยนรหัส

เส้นทาง Go `/v1/dashboard/*` เป็น service-to-service ของ BFF เท่านั้น ไม่ใช่ browser contract ส่วน `/v1/alerts` สำหรับ service และ capability Ack จากมือถือเป็น flow แยก ไม่มีปุ่ม browser สำหรับปลอมการรับทราบ

การเปลี่ยน permission กระทบ Web `/api/*` ที่ระบุด้านบน ไม่บังคับให้ service ต้นทางหรือมือถือไป login ผ่านหน้าเว็บ และไม่เปลี่ยนค่า default critical ของ service API เดิม

## 2. Transport และ state eligibility

- ใช้ same-origin `fetch` พร้อม cookie โดยอัตโนมัติ ไม่เก็บ session token ใน localStorage/sessionStorage และไม่ส่ง Bearer application key จาก browser
- ทุก mutation ส่ง `Content-Type: application/json` และ `X-Notify-Request: dashboard`; browser จะส่ง `Origin` เอง ห้ามรับคำสั่งให้ปิดการตรวจ origin เมื่อเจอ 403
- Server ใช้ HttpOnly cookie สำหรับ session; production เป็น Secure/host-only/SameSite ไม่ตั้ง Domain ให้ subdomain อื่น FE ไม่อ่านค่า cookie นี้
- ผลลัพธ์ auth สำหรับ browser ไม่มี `session_token`, password hash หรือ privileged key
- ไม่ตั้ง credentialed wildcard CORS; application นี้ไม่ใช่ cross-origin browser API
- `401 session_required`: ล้างข้อมูล protected ที่ค้างและไป login ไม่ retry loop
- `403 password_change_required`: ไปหน้าเปลี่ยนรหัส ห้ามอ่านประวัติ/ส่งทดสอบระหว่างรอ
- Session จำกัดสิทธิ์ครั้งแรกเรียกได้เฉพาะ session/change-password/logout เท่านั้น การซ่อนเมนูอย่างเดียวไม่ใช่ authorization
- `429 rate_limited`: เคารพ `Retry-After`; ไม่ยิง login/password/send ซ้ำอัตโนมัติ

### Shared auth result

```json
{
  "user": { "username": "admin", "must_change_password": true },
  "expires_at": "2026-10-30T07:00:00Z"
}
```

| Field | Type/ความหมาย |
|---|---|
| `user.username` | string: ชื่อผู้ดูแลที่ server ยืนยันแล้ว ไม่ใช่ข้อมูลระบุผู้กด Ack บนมือถือ |
| `user.must_change_password` | boolean: true ห้ามเข้าหน้า/ข้อมูล protected อื่น |
| `expires_at` | UTC RFC3339 timestamp: เวลาหมดอายุ session ไม่ใช่เวลาหมดอายุ alert |

### Shared browser error

```json
{ "error": "ข้อความสำหรับผู้ใช้", "code": "session_required" }
```

`error` คือข้อความแสดงผล ไม่ใช้ข้อความเป็นเงื่อนไขทางธุรกิจ ให้ใช้ HTTP status และ `code` ส่วน request/network failure ที่ยังไม่ทราบผล mutation ต้องไม่ถูกตีความว่า server ไม่ได้ทำงาน

| HTTP | Code ที่เกี่ยวข้อง | Trigger / FE recovery |
|---|---|---|
| 400 | `invalid_schema`, query validation codes ตาม endpoint | JSON/key/type/query ไม่ผ่าน แก้ input ไม่ retry วน |
| 401 | `session_required`, `invalid_credentials` | session ไม่มี/หมดอายุ หรือ credential ไม่ตรง; เลือก login/error ตาม code |
| 403 | `invalid_origin`, `password_change_required` | transport guard ไม่ผ่าน หรือยังต้องเปลี่ยนรหัส; ไม่ข้าม guard โดยปิด CSRF |
| 404 | `not_found` | full session ขอ alert ที่ไม่มีอยู่ แสดงไม่พบ ไม่แทนด้วย Ack ว่าง |
| 409 | `idempotency_conflict`, `alert_id_conflict` | identity ซ้ำกับข้อมูลอื่น หยุดและตรวจ attempt เดิม |
| 413 | `body_too_large` | payload ใหญ่เกินขนาดที่ปลายทางรับ ไม่ส่งซ้ำแบบเดิม |
| 422 | `invalid_password`, `password_unchanged`, `payload_too_large` | schema ผ่านแต่ผิดข้อกำหนด field/bytes แสดง validation |
| 429 | `rate_limited` + `Retry-After` | รอตามจำนวนวินาที ไม่ส่งอัตโนมัติ |
| 502 | `upstream_error`, provider errors ตามข้อ 11 | malformed/unavailable/unknown send outcome; ไม่ถือว่าไม่เคยส่ง |
| 503 | `server_configuration`, `dashboard_not_configured`, `fcm_not_configured`, `temporarily_unavailable`, state/database unavailable ตามข้อ 11 | ระบบ/การตั้งค่าไม่พร้อม ไม่แสดง success หรือขอ privileged key จาก browser |

ตัวอย่าง 429 (ใช้ได้ทั้ง login/change-password/data/send ตาม admission ของ endpoint):

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
Content-Type: application/json

{"error":"คำขอมากเกินไป กรุณารอแล้วลองใหม่","code":"rate_limited"}
```

ตัวอย่าง 503 สำหรับหน้าส่งทดสอบที่ provider ยังไม่พร้อม:

```json
{"error":"ระบบส่งแจ้งเตือนยังไม่พร้อม","code":"fcm_not_configured"}
```

<a id="login"></a>
## 3. Login — POST /api/auth/login

ผู้เรียก: anonymous; cookie เดิมไม่ใช่ข้อยืนยันว่าข้ามการตรวจ credential ได้

```http
POST /api/auth/login
Content-Type: application/json
X-Notify-Request: dashboard

{"username":"admin","password":"Synthetic_bootstrap_for_docs_only_2026"}
```

ตัวอย่างทุก credential ในเอกสารเป็น synthetic ห้ามนำไปใช้ตั้ง production

| Request field | Type/เงื่อนไข | FE action |
|---|---|---|
| `username` | string ไม่เกิน 64 UTF-8 bytes: ชื่อที่ตั้งไว้ยาว 3–64 ASCII `A-Z a-z 0-9 _ . -` และเป็น case-sensitive | autocomplete username; ไม่สร้างบัญชีหาก login ไม่สำเร็จ |
| `password` | string ไม่เกิน 128 UTF-8 bytes: รหัสปัจจุบัน/รหัสเริ่มต้น | input password; ไม่ trim หรือบันทึกลง log/storage |

สำเร็จ `200`: shared auth result และ Set-Cookie จาก server หาก `must_change_password=true` ไป `/change-password`; false ไปหน้าประวัติ ไม่ส่ง token ผ่าน URL

Errors: `400 invalid_schema`, `401 invalid_credentials`, `429 rate_limited`, `503 dashboard_not_configured` หรือ unavailable/configuration error ไม่แสดงว่าบัญชีมีอยู่หรือไม่จาก invalid credentials

ตัวอย่าง `401`:

```json
{"error":"ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง","code":"invalid_credentials"}
```

สถานะ UI: disable ระหว่างกำลังส่ง, แสดง credential error แบบทั่วไป, ไม่ตั้งค่ารหัสเริ่มต้นผ่านหน้า login และไม่มี public signup/reset-email link

<a id="session"></a>
## 4. Session — GET /api/auth/session

ไม่มี query/body/header credential ที่ FE ต้องสร้าง ใช้ cookie เดิม:

```http
GET /api/auth/session
```

สำเร็จ `200`: shared auth result; ใช้ได้กับ restricted session และ full session ไม่มี token field Errors: `401 session_required` หรือ `503` เมื่อ service/configuration ไม่พร้อม

ตัวอย่าง `401`:

```json
{"error":"กรุณาเข้าสู่ระบบ","code":"session_required"}
```

FE ต้องแยกผู้ใช้ยังไม่ login, ต้องเปลี่ยนรหัส, และ backend ไม่พร้อม ห้ามแทน unavailable ด้วยข้อมูลสาธิตหรือถือว่าเป็น full session

<a id="change-password"></a>
## 5. Change password — POST /api/auth/change-password

ผู้เรียก: restricted/full session ที่ยังมีผล ไม่ใช่ endpoint reset ของ anonymous

```http
POST /api/auth/change-password
Content-Type: application/json
X-Notify-Request: dashboard

{
  "current_password":"Synthetic_bootstrap_for_docs_only_2026",
  "new_password":"Synthetic new passphrase documentation only 2026"
}
```

| Request field | Type/เงื่อนไข | FE action |
|---|---|---|
| `current_password` | string: รหัสปัจจุบัน | ไม่ส่งรหัสที่คาดเดาหรือรหัสเก่าจาก cache |
| `new_password` | string: อย่างน้อย 15 Unicode code points และไม่เกิน 128 UTF-8 bytes ต้องต่างจากรหัสเดิมและรหัส bootstrap ครั้งแรก | ตรวจช่องยืนยันใน UI แต่ไม่ส่ง field ยืนยันเพิ่มไป backend |

สำเร็จ `200`: shared auth result โดย `must_change_password=false` และ session cookie ใหม่ Session เก่ารวมถึงแท็บ/เครื่องอื่นถูก revoke ต้องรองรับ 401 เมื่อใช้ session เก่า

Errors: `401 session_required`, `401 invalid_credentials`, `422 invalid_password`, `422 password_unchanged`, `429 rate_limited`, unavailable `503`; mismatch ช่องยืนยันเป็น client validation ไม่ใช่หลักฐานว่า server ได้รับ/เปลี่ยนรหัสแล้ว

ตัวอย่าง `422`:

```json
{"error":"รหัสผ่านต้องมีอย่างน้อย 15 ตัวอักษร และไม่เกิน 128 ไบต์","code":"invalid_password"}
```

<a id="logout"></a>
## 6. Logout — POST /api/auth/logout

ไม่มี body; ส่ง mutation headers ตามข้อ 2:

```http
POST /api/auth/logout
Content-Type: application/json
X-Notify-Request: dashboard
```

สำเร็จ `200`:

```json
{"ok":true}
```

`ok` เป็น boolean ผลออกจากระบบ ไม่ใช่ผล Ack บนมือถือ ล้าง protected client state และไป login ห้ามเก็บ history/detail จาก session ก่อนหน้าไว้ให้ session ถัดไปเห็น รองรับ logout ซ้ำ/session หมดอายุ; ห้ามแสดงว่าถูก revoke สำเร็จเมื่อ request ยังไม่ทราบผล

Origin/header ไม่ถูกต้องได้ `403 invalid_origin` แม้ session ยังไม่หมดอายุ ความขัดข้องของ upstream อาจได้ `502/503`; ฝั่ง browser อาจถูกล้าง cookie แล้ว แต่ไม่ใช่หลักฐานว่า server ยืนยัน revoke สำเร็จ

<a id="history"></a>
## 7. History — GET /api/history

ผู้เรียก: full session เท่านั้น ไม่มี body

```http
GET /api/history?from=2026-10-28T17%3A00%3A00Z&to=2026-10-29T17%3A00%3A00Z&status=all&limit=25
```

| Query | Type/default/เงื่อนไข |
|---|---|
| `from`, `to` | required UTC RFC3339; from < to; ช่วงเริ่มรวม/สิ้นสุดไม่รวมตาม contract ประวัติเดิม |
| `status` | optional default `all`; `provider_accepted`, `provider_failed`, `delivery_unknown`, `acknowledged`, `pending_ack` |
| `limit` | optional integer 1–25 default 25 |
| `cursor` | optional opaque string จาก `next_cursor`; ไม่สร้าง/แก้ค่าเอง ไม่เกิน 2048 ตัว |

ไม่ส่ง query ซ้ำหรือ unknown query

API ใช้ UTC ส่วนหน้าจอแสดง Asia/Bangkok (UTC+7) ถ้า UI เลือก “ถึงวันที่ 29 ต.ค.” แบบรวมทั้งวัน ให้ส่ง `to` เป็นเที่ยงคืนกรุงเทพฯ ของวันถัดไป เช่นตัวอย่างจาก `2026-10-28T17:00:00Z` ถึง `2026-10-29T17:00:00Z` ครอบคลุมวันที่ 29 ต.ค. ในกรุงเทพฯ ช่อง HTML date ส่งปี ค.ศ. ไม่ใช้ พ.ศ. ใน wire

สำเร็จ `200`:

```json
{
  "items":[{
    "alert_id":"e4ba58bc-7872-4a31-9601-50edb63fccef",
    "title":"ทดสอบแบบเงียบ",
    "message":"ข้อมูลตัวอย่าง ไม่ใช่เหตุการณ์จริง",
    "status":"provider_accepted",
    "importance":"normal",
    "created_at":"2026-10-29T07:00:00Z",
    "provider_accepted_at":"2026-10-29T07:00:01Z",
    "expires_at":"2026-10-29T07:05:00Z",
    "acknowledged_at":"2026-10-29T07:10:00Z",
    "ack_count":1,
    "last_ack_at":"2026-10-29T07:10:00Z"
  }],
  "next_cursor":null
}
```

`items` คือ array ของ alert summary ตามข้อ 10; `next_cursor` string/null ถ้า null ไม่มีหน้าถัดไป ไม่ใช่ total pages เมื่อเปลี่ยน filter ให้ล้าง cursor เดิม ใช้ loading/empty/error/stale แยกกัน ห้ามแทน fetch error ด้วย array ว่าง

กรณีไม่มีรายการ ไม่ใช่ fetch error:

```json
{"items":[],"next_cursor":null}
```

Errors: `400 invalid_schema` สำหรับ browser query ที่ไม่ผ่าน allowlist, backend validation อาจตอบ `400 invalid_from/invalid_to/invalid_range/invalid_status/invalid_limit/invalid_cursor`, `401 session_required`, `403 password_change_required`, `429 rate_limited`, upstream/unavailable `502/503`

ตัวอย่าง `403`:

```json
{"error":"กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน","code":"password_change_required"}
```

<a id="stats"></a>
## 8. Statistics — GET /api/stats

ผู้เรียก: full session เท่านั้น ไม่มี body ใช้ `from`/`to` แบบ history ไม่รับ `status`, `limit`, `cursor`

```http
GET /api/stats?from=2026-10-28T17%3A00%3A00Z&to=2026-10-29T17%3A00%3A00Z
```

สำเร็จ `200`:

```json
{
  "total_alerts":0,"provider_accepted":0,"provider_failed":0,"delivery_unknown":0,
  "acknowledged":0,"pending_ack":0,"ack_action_count":0
}
```

ทุก field เป็นจำนวน integer หรือ null เมื่อ contract ระบุไม่ทราบ ไม่แทน null ด้วย 0 `acknowledged`/`pending_ack` นับเหตุการณ์ ส่วน `ack_action_count` นับ action ID ไม่ซ้ำข้ามเหตุการณ์ จึงไม่ใช่ผลบวก `ack_count` ของทุกแถว ภาพรวมไม่ใช้ history status filter

| Response field | ความหมายในช่วง `created_at` ที่เลือก |
|---|---|
| `total_alerts` | จำนวน alert ทั้งหมด ไม่ใช่จำนวนที่โหลดแล้วใน browser |
| `provider_accepted` | จำนวน outcome ที่ provider ตอบรับ ไม่ใช่จำนวนโทรศัพท์ได้รับ |
| `provider_failed` | จำนวน outcome ที่ provider ส่งไม่สำเร็จ |
| `delivery_unknown` | จำนวน outcome ที่ยังยืนยันผลส่งไม่ได้ ไม่เท่ากับ failed |
| `acknowledged` | จำนวน alert ที่มีรายงาน Ack อย่างน้อยหนึ่ง action ไม่ขึ้นกับ provider outcome |
| `pending_ack` | เฉพาะ alert ที่ provider accepted และยังไม่มี Ack ไม่ใช่ `total_alerts - acknowledged` |
| `ack_action_count` | จำนวน UUID action ไม่ซ้ำของ alert ในช่วงนั้น ไม่นับตามช่วง `received_at` แยกต่างหาก |

Ack ที่รายงานมาภายหลังทำให้สรุปของวันสร้าง alert เดิมเปลี่ยนได้ UI ต้องระบุเวลาที่โหลดล่าสุด ไม่ตีความว่าค่าเป็นยอดปิดวันถาวร

Errors/permission เหมือน history; ให้แสดง loading/error ของ summary แยกจากรายการ และระบุเมื่อกำลังแสดงค่าครั้งก่อน

ตัวอย่าง invalid query `400`:

```json
{"error":"ข้อมูลคำขอไม่ถูกต้อง","code":"invalid_schema"}
```

<a id="detail"></a>
## 9. Detail — GET /api/alerts/{id}

ผู้เรียก: full session เท่านั้น ไม่มี query/body

```http
GET /api/alerts/e4ba58bc-7872-4a31-9601-50edb63fccef
```

`id` คือ alert ID จากรายการหรือ receipt ไม่ใช่ token; encode path component ไม่รับ arbitrary path/URL สำเร็จ `200` เป็น alert summary พร้อม `ack_actions` ตามข้อ 10

```json
{
  "alert_id":"e4ba58bc-7872-4a31-9601-50edb63fccef",
  "title":"ทดสอบแบบเงียบ",
  "message":"ข้อมูลตัวอย่าง ไม่ใช่เหตุการณ์จริง",
  "status":"provider_accepted",
  "importance":"normal",
  "created_at":"2026-10-29T07:00:00Z",
  "provider_accepted_at":"2026-10-29T07:00:01Z",
  "expires_at":"2026-10-29T07:05:00Z",
  "acknowledged_at":"2026-10-29T07:10:00Z",
  "ack_count":1,
  "last_ack_at":"2026-10-29T07:10:00Z",
  "ack_actions":[{
    "client_action_id":"8f00d6da-cdf0-4854-a57b-6151c6d7c0fb",
    "client_acked_at":"2026-10-29T07:01:18Z",
    "received_at":"2026-10-29T07:10:00Z"
  }]
}
```

ตัวอย่างแสดงเวลาเครื่องรายงานก่อนเวลา server รับได้ เพราะอุปกรณ์อาจออฟไลน์ ไม่แก้เวลาเครื่องให้เท่ากับ server และไม่ทิ้ง Ack เพียงเพราะมาถึงหลัง latest-start

Errors: invalid ID `400`, ไม่พบ `404`, `401 session_required`, `403 password_change_required`, upstream/unavailable `502/503` การไม่มี Ack ไม่ใช่ detail not-found

```json
{"error":"ไม่พบเหตุการณ์","code":"not_found"}
```

## 10. Summary/detail fields และเวลา Ack

| Response field | Type/ความหมาย |
|---|---|
| `alert_id` | string: ID ของเหตุการณ์ |
| `title`, `message` | string: ข้อความ plain text ไม่ render เป็น HTML |
| `status` | `provider_accepted`, `provider_failed`, `delivery_unknown` แยกจาก Ack; `acknowledged`/`pending_ack` เป็น filter ไม่ใช่ค่าของ field นี้ |
| `importance` | `normal` หรือ `critical`; ประวัติเก่าที่ไม่มี field รองรับตาม legacy contract แต่ค่า unknown/null ไม่เดาเป็นระดับอื่น |
| `created_at` | UTC RFC3339: สร้างเหตุการณ์ |
| `provider_accepted_at` | timestamp/null: provider ตอบรับ ไม่ใช่เวลามือถือได้รับหรือเสียงเริ่ม |
| `expires_at` | timestamp/null: latest start ไม่ใช่เวลาหยุด critical ที่เริ่มแล้ว |
| `acknowledged_at` | timestamp/null: เวลา server รับรายงาน Ack แรก |
| `ack_count` | integer/null: action ที่ไม่ซ้ำของเหตุการณ์นี้ ไม่ใช่ HTTP retry count |
| `last_ack_at` | timestamp/null: เวลา server รับรายงาน Ack ล่าสุด |
| `ack_actions` | array: มีเฉพาะ detail; ว่างได้ |
| `ack_actions[].client_action_id` | UUID string: หนึ่ง human action อาจใช้กับหลายเหตุการณ์ ห้ามรวมเป็นหลายการกด |
| `ack_actions[].client_acked_at` | timestamp/null: เวลาที่มือถือรายงาน อาจไม่ตรง clock server |
| `ack_actions[].received_at` | timestamp: เวลา server รับรายงาน เป็นหลักฐานเวลาที่ server ทราบ |

ใช้คำว่า “มีรายงานแตะรับทราบ” ไม่ใช่ยืนยันตัวบุคคลหรือได้ยินเสียงแล้ว ไม่เห็นรายงานอาจหมายถึงมือถือกดหยุดแล้วแต่ยังออฟไลน์ การกดหยุดในมือถือไม่รอ server และการกลับ ON ไม่ใช่ human Ack

<a id="test-alerts"></a>
## 11. Test notification — POST /api/test-alerts

ผู้เรียก: full session เท่านั้น เป็นการส่งจริงไปอุปกรณ์ที่ server ตั้งไว้เมื่อ runtime ใช้ sender จริง ไม่ใช่การ preview เสียงใน browser

ไม่มี field เลือก device/group/FCM token จาก browser และไม่มี API รายงานว่าอุปกรณ์ online หรือเวอร์ชัน APK เท่าไร ห้ามขอ token/key จากผู้ใช้หรือสร้างสถานะ “พร้อมดัง” จาก provider acceptance

- `normal`: แจ้งเตือนเงียบ ไม่สั่น ไม่เริ่ม alarm foreground service/fullscreen และไม่หยุด critical ที่กำลังดัง อาจไม่ได้เริ่มทันทีตามสถานะ Android/การส่ง ต้องใช้ APK ที่รองรับโหมดนี้ (ตั้งแต่ 0.5.0-importance); APK เก่าจะไม่ถูกบังคับยกระดับเป็นปลุกแทน
- `critical`: เมื่ออุปกรณ์เริ่มเสียงได้แล้วจะดังต่อเนื่องจนผู้ใช้กดรับทราบ ไม่ได้ยืนยันว่าทุก OS state จะรับหรือเริ่มได้ จึงต้องแยก provider result กับรายงาน Ack เสมอ
- ถ้าใช้ข้อมูลสาธิต ต้องติดป้ายชัด ไม่สวมข้อมูลสมมติเป็นการส่ง/กดบนโทรศัพท์จริง รายละเอียดโหมดเดิมอยู่ใน [importance contract](notification-importance-th.md)

```http
POST /api/test-alerts
Content-Type: application/json
X-Notify-Request: dashboard
Idempotency-Key: e4ba58bc-7872-4a31-9601-50edb63fccef

{
  "alert_id":"e4ba58bc-7872-4a31-9601-50edb63fccef",
  "title":"ทดสอบแบบเงียบ",
  "message":"ข้อความทดสอบจากผู้ดูแล",
  "ttl_seconds":300,
  "importance":"normal"
}
```

| Header/body | Type/เงื่อนไข | FE responsibility |
|---|---|---|
| `Idempotency-Key` | **Browser route นี้** รับ 16–128 ASCII `A-Z a-z 0-9 _ -` ซึ่งแคบกว่า service API เดิม | ใช้ UUID ใหม่ต่อ human send แล้วคงค่าเดิมตลอด retry |
| `alert_id` | required string 1–100 ASCII `A-Z a-z 0-9 _ -` | สร้างครั้งเดียวต่อการส่งที่ผู้ใช้ยืนยัน ไม่สุ่มใหม่ตอน retry |
| `title` | required nonempty string สูงสุด 120 Unicode characters | label/validation ชัด ไม่แปลงข้อความเป็น HTML |
| `message` | required nonempty string สูงสุด 2000 Unicode characters | ยังต้องรับ payload-byte validation จาก server |
| `ttl_seconds` | required integer 30–10800; UI เริ่ม 300 | หน่วยวินาที ไม่ใช่ระยะเวลาปลุก |
| `importance` | required `normal` หรือ `critical` ใน browser route | UI ส่งชัดเจนเสมอ เริ่มที่ normal; ห้ามพึ่ง default critical ของ service API |

แบบ critical ต้องแสดงคำเตือนว่าเริ่มปลุกแล้วดังต่อเนื่องจนกดรับทราบบนอุปกรณ์ และให้ยืนยันก่อนส่ง ไม่อ้างว่า TTL ทำให้หยุดเสียง

สำเร็จ `202` เป็น receipt ไม่ใช่ delivery proof:

```json
{
  "alert_id":"e4ba58bc-7872-4a31-9601-50edb63fccef",
  "status":"provider_accepted",
  "expires_at":"2026-10-29T07:05:00Z",
  "acknowledged":false,
  "delivery_verified":false,
  "importance":"normal"
}
```

| Receipt field | ความหมาย |
|---|---|
| `alert_id` | ใช้เปิด detail/ตรวจประวัติ ไม่สร้างเหตุการณ์ซ้ำเพื่อเช็คสถานะ |
| `status` | ผล provider ที่ทราบ ยังไม่ใช่ผลรับ/ส่งเสียงของมือถือ |
| `expires_at` | latest start ของข้อความ ไม่ใช่เวลาหยุดเสียง |
| `acknowledged` | false ใน create receipt ไม่แทนการโหลดสถานะ Ack ล่าสุด |
| `delivery_verified` | false; ห้ามแสดงว่า delivery verified |
| `importance` | โหมดที่ server ยืนยัน ไม่เดาจากสีหรือข้อความ |

Errors: browser schema/body/key ไม่ถูกต้องได้ `400 invalid_schema`; Host/Origin/CSRF header หรือ Content-Type ไม่ผ่าน guard ได้ `403 invalid_origin` ไม่ใช่ login failure การตรวจ payload ฝั่งปลายทางยังอาจได้ `413 body_too_large` หรือ `422 payload_too_large` นอกจากนี้มี session `401/403`, reused key ต่าง payload `409`, `429`, `503 fcm_not_configured`, provider failed/unknown `502` และ network timeout ต้องแสดง “ยังไม่ทราบผล” เมื่อยืนยันไม่ได้ ห้าม auto-send ด้วย ID/key ใหม่ ให้ตรวจประวัติหรือ retry ด้วยข้อมูลและ identity เดิมเท่านั้น

ตัวอย่าง `409` และ `502` ตามลำดับ:

```json
{"error":"รหัสคำขอนี้ถูกใช้กับข้อมูลอื่นแล้ว","code":"idempotency_conflict"}
```

```json
{"error":"ไม่ทราบผลส่ง โปรดตรวจสอบประวัติ","code":"provider_delivery_unknown"}
```

| กลุ่ม error code | การตอบสนอง FE |
|---|---|
| `invalid_schema`, `invalid_message`, `invalid_alert_id`, `invalid_ttl`, `invalid_importance`, `payload_too_large`, `json_required`, `body_too_large` | แก้ input/header ตาม field/byte limit; อย่าสุ่ม ID เพื่อหลบ validation |
| `idempotency_conflict`, `alert_id_conflict` | หยุด retry ด้วยข้อมูลที่เปลี่ยน ตรวจ attempt เดิม; อย่าตีความว่าเป็นคำขอใหม่สำเร็จ |
| `rate_limited` | รอตาม `Retry-After` ไม่ส่งอัตโนมัติ |
| `provider_delivery_unknown`, `delivery_unknown_or_in_progress`, `delivery_state_unavailable`, `upstream_error`, request timeout | อาจมีเหตุการณ์แล้ว ใช้ alert ID เดิมตรวจ history/detail หรือ retry attempt เดิม |
| `provider_rejected`, `provider_unavailable`, `provider_authentication_failed`, `fcm_not_configured` | แสดงว่าส่ง/ยืนยันผลไม่ได้ ไม่เปลี่ยนเป็น provider accepted และไม่สร้าง Ack |
| `server_configuration`, `dashboard_not_configured`, `database_unavailable`, `temporarily_unavailable` | สถานะระบบไม่พร้อม ไม่แทนด้วย demo success และไม่ขอให้ผู้ใช้กรอก privileged key ในหน้าเว็บ |

ตารางรวม field-specific upstream codes ที่ BFF รู้จักด้วย; ไม่ได้หมายความว่า browser schema ที่ผิดจะผ่านไปจนได้ code เฉพาะ field เสมอ โดยเฉพาะ missing/null/unknown importance ใน browser route จะเป็น `400 invalid_schema` ไม่ fallback เป็น critical

## 12. FE adoption checklist

- [ ] เปลี่ยน localhost-only flow เป็น server-enforced session และ canonical-origin/CSRF handling
- [ ] Login → force-change → history/send; ทดสอบเรียก API ตรงระหว่าง force-change ต้องไม่ผ่าน
- [ ] Logout/password-change/expiry ล้าง protected state และไม่ทำให้แท็บเก่าข้ามสิทธิ์ได้
- [ ] Form ส่ง explicit normal/critical พร้อม confirmation ที่เหมาะสมและ single in-flight state
- [ ] เก็บ ID/key เดิมใน uncertain attempt; ไม่แปลง timeout เป็นไม่เคยส่ง
- [ ] Provider/Ack/TTL/clock labels ไม่อ้างการรับหรือเสียงที่ไม่เคยรายงาน
- [ ] ข้อมูลสาธิต/ข้อมูลเก่า/loading/empty/unavailable แยกชัด ไม่มีตัวเลขหรือ Ack จำลองแทนผลจริง
- [ ] Dark/light/system, keyboard/focus และ mobile reflow ไม่ซ่อนปุ่มยืนยัน/คำเตือน critical
