# Notify Alarm — API bridge สำหรับ PoC เครื่องเดียว

ใช้ Node.js **22 ขึ้นไป** ไม่ต้อง `npm install` และไม่มี dependency ภายนอก Default bind คือ `127.0.0.1:8787` เปิดผ่านเครื่อง server เองเท่านั้น

## ขอบเขตจริง

- `POST /v1/alerts` ส่ง FCM HTTP v1 data message หา Pixel เครื่องเดียวตาม `FCM_DEVICE_TOKEN`; critical ใช้ HIGH, normal ใช้ NORMAL (อาจถูกเลื่อนการส่ง)
- `202` หลัง FCM ตอบรับเท่านั้น โดยสถานะเป็น `provider_accepted` **ไม่ใช่ delivered / alarm_started / ผู้ใช้ได้ยิน**
- เมื่อกำหนด `ACK_PUBLIC_BASE_URL` จะเปิด API รับ Ack จากแอปแบบ per-alert capability และ receipt query; หากไม่กำหนดจะ **ไม่ส่ง capability และไม่มี Ack endpoint** แอปหยุดเสียงในเครื่องได้ แต่ server ยังไม่ทราบว่าผู้ใช้รับทราบแล้ว
- ยังไม่มี retry scheduler, device registration, callback, escalation หรือหลายเครื่อง
- `ttl_seconds` เป็น **เวลาช้าที่สุดที่จะเริ่มปลุก** ค่าเริ่มต้น 300 วินาที ไม่ใช่ระยะเวลาส่งเสียง หลังเครื่องเริ่มแล้วใช้การกดรับทราบหยุดเสียง ไม่ให้หมด TTL แล้วหยุดเอง
- ไม่มีการ retry ส่ง FCM อัตโนมัติ ไม่รับประกันว่าตู้ดับแล้วจะได้รับแจ้งทุกครั้ง
- เป็น bridge PoC ขนาดเล็ก ไม่ใช่ implementation ครบตาม API proposal ใน `docs/remote-alert-system-th.md`

## การเตรียม

1. สร้าง Firebase project และ Android app ที่ package ตรงกับ APK แล้วตั้งค่า Firebase ในแอปตามเอกสาร Android ของโปรเจกต์
2. เปิด Firebase Cloud Messaging API (HTTP v1) และให้ service account มีสิทธิ์ส่งข้อความใน project เป้าหมาย ใช้สิทธิ์เท่าที่จำเป็น ไม่ใช้ Owner โดยไม่จำเป็น
3. ดาวน์โหลด service-account JSON เก็บ **นอก repository** ไม่ commit ไม่ paste เนื้อหา private key ลง chat
4. เปิดแอปบน Pixel อนุญาต notification แล้วคัดลอก FCM registration token (อาจเปลี่ยนเมื่อ reinstall/clear data ต้องอัปเดตค่า server)
5. ตั้ง environment ใน shell ด้วย secret store/ตัวแปรที่มีอยู่ ไม่แสดงค่า key/token ใน log และอย่าใส่ค่าจริงในไฟล์ตัวอย่าง

ตัวอย่าง PowerShell (placeholder path ไม่ใช่ credential จริง):

```powershell
# ALERT_API_KEY ต้องเป็น random secret อย่างน้อย 32 bytes
# ตัวอย่างสร้างในหน่วยความจำ ไม่พิมพ์ค่า secret ออก console
$env:ALERT_API_KEY = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
$env:GOOGLE_APPLICATION_CREDENTIALS = 'D:\secrets\notify-firebase-service-account.json'
# FCM_DEVICE_TOKEN ให้ตั้งจาก secret store/ตัวแปรที่จัดเตรียมแล้ว
$env:FCM_DEVICE_TOKEN = $env:PIXEL_FCM_TOKEN
node .\server\index.mjs
```

ต้องรักษาค่า `ALERT_API_KEY` เดิมอย่างปลอดภัยสำหรับ caller ไม่สร้างใหม่ทุกครั้งหากมีระบบต้นทางใช้อยู่แล้ว Environment นี้ต้องตั้งทั้งฝั่ง process ที่รัน server และ caller หากอยู่คนละ shell/process

| Environment | ความหมาย |
|---|---|
| `ALERT_API_KEY` | required, secret อย่างน้อย 32 bytes ใช้ Bearer auth สำหรับ API |
| `GOOGLE_APPLICATION_CREDENTIALS` | path service-account JSON นอก repo |
| `FCM_DEVICE_TOKEN` | registration token ของ Pixel เป้าหมาย |
| `PORT` | default `8787` |
| `HOST` | default `127.0.0.1`; ไม่เปลี่ยนเป็น public interface โดยไม่มี TLS/firewall/auth ที่เหมาะสม |
| `ALERT_STATE_PATH` | optional path idempotency JSON default `server/.data/idempotency.json` |
| `ACK_PUBLIC_BASE_URL` | optional public **HTTPS** base URL ของ reverse proxy ที่ route ไป bridge นี้ เช่น `https://alerts.example.invalid`; ห้ามมี userinfo, query, fragment หรือ HTTP; **ไม่ตั้งค่า default** ต้องให้ผู้ดูแลยืนยัน URL ที่เครื่องเข้าถึงได้ก่อนเปิดใช้ |
| `ACK_STATE_PATH` | optional durable Ack ledger path; default `${ALERT_STATE_PATH}.acks.json` เก็บ hash capability เท่านั้น; สำรองและจำกัดสิทธิ์ไฟล์เหมือน idempotency state |

ขาด Firebase path/token จะเปิด server ได้ แต่ `/health` คืน `ready:false` และส่ง alert ตอบ 503 หากตั้งค่ามาแต่ credentials ไม่ถูกต้อง server ปฏิเสธ startup โดยไม่พิมพ์รายละเอียดลับ

## เรียก API

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health'

$headers = @{
    Authorization = "Bearer $env:ALERT_API_KEY"
    'Idempotency-Key' = 'cabinet-42-outage-20261019-001'
}
$body = @{
    alert_id = 'cabinet-42-outage-001'
    title = 'ตู้น้ำมันหยุดทำงาน'
    message = 'เหตุการณ์ทดสอบ กรุณารับทราบบน Pixel'
    ttl_seconds = 300
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/v1/alerts' `
    -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

`GET /health` ไม่ต้อง auth และเผยเฉพาะ configuration status ไม่มี credential/device token `ready:true` แปลว่าโหลด config สำหรับส่งได้ **ไม่ยืนยัน OAuth, FCM delivery หรือเสียงจริง** `delivery_verified:false`; `ack_sync_supported:true` หมายถึงกำหนด public Ack URL และเปิด durable Ack ledger เท่านั้น ไม่ยืนยัน HTTPS routing หรือว่า Pixel sync สำเร็จ

### Request contract

- `importance`: optional `"normal"` or `"critical"`, omitted defaults to `"critical"`; null/unknown values reject with 4xx. Critical retains continuous alarm until human Ack with HIGH FCM transport. Normal is notification-only (no sound, vibration or fullscreen), uses NORMAL transport and can be deferred. FCM data and POST/GET detail receipts include normalized `importance`; it counts toward the 4,000-byte data budget. Critical and legacy send `type=alert`, while normal sends `type=notice`: old APKs ignore the unknown notice rather than accidentally ring a normal notification as a critical alarm. Upgrade Android to receive normal notices. Omitted and explicit critical use the original idempotency hash, normal is distinct. Existing state entries missing the field read as critical without rewriting stored records. Unknown stored modes fail startup.

- `Content-Type: application/json`, `Authorization: Bearer ...`, `Idempotency-Key` required (อักษร A–Z/a–z/0–9/`_.:-` ความยาว 1–128)
- `title`: nonblank สูงสุด 120 Unicode code points
- `message`: nonblank สูงสุด 2,000 Unicode code points แต่ยังต้องผ่าน byte budget
- `alert_id`: optional; ถ้าไม่ส่ง server สร้างให้ รูปแบบ `[A-Za-z0-9_-]` 1–100 ตัว ควรไม่ใช้ ID เดิมสำหรับ incident ใหม่ เพราะแอปมี durable dedupe/Ack tombstone
- `ttl_seconds`: integer 30–10,800 default 300; ห้ามใช้แทนเวลาที่ต้องการให้เสียงหยุด
- ปฏิเสธ field ที่ไม่รู้จัก ไม่มี remote cancel/ack command จาก endpoint นี้
- Request body ไม่เกิน 16 KiB และ serialized FCM data ไม่เกิน **4,000 bytes** เพื่อเผื่อจากเพดาน FCM 4,096 bytes ภาษาไทยอาจเกินแม้จำนวนอักษรผ่าน
- Output FCM data: `type=alert` สำหรับ critical หรือ `type=notice` สำหรับ normal, `importance`, `alert_id`, `title`, `message`, `expires_at` (UTC ISO8601); เมื่อเปิด Ack เพิ่ม `ack_url` และ random `ack_token` 32-byte base64url **เฉพาะ FCM data** (ไม่อยู่ใน response/status/file/log); Android priority HIGH สำหรับ critical หรือ NORMAL สำหรับ normal และ transport TTL ไม่เกินเวลาที่เหลือ โดย budget 4,000 bytes นับรวมสอง field ใหม่นี้

### Ack และ receipt (เปิดใช้เมื่อกำหนด HTTPS base URL เท่านั้น)

- `POST /v1/alerts/{alert_id}/ack` ต้องใช้ `Authorization: Bearer <ack_token>` จาก FCM data **ไม่ใช่ `ALERT_API_KEY`** และ `Content-Type: application/json`; body `{}` หรือ `{"client_acked_at":"2026-10-19T10:00:00.000Z"}` (UTC ISO timestamp optional, telemetry เท่านั้น) จำกัด 16 KiB; ไม่รองรับ list/read ด้วย capability
- ตอบ `200 {"alert_id":"...","status":"acknowledged","acknowledged_at":"...","client_acked_at":"..."}` หลังบันทึก durable เท่านั้น; `acknowledged_at` เป็นเวลา server authoritative; repeat ด้วย capability เดิมคืน Ack เวลาเดิมรวม client telemetry เดิม ไม่มีการแก้ย้อนหลัง; unknown ID/token ผิด/ใช้ token ของอีก alert ตอบ 401
- `GET /v1/alerts/{alert_id}` ต้องใช้ **application** Bearer (`ALERT_API_KEY`) เท่านั้น คืน `status` ของ provider receipt, `acknowledged`, `acknowledged_at` ถ้ามี, `delivery_verified:false`; `provider_accepted` **ไม่ใช่หลักฐานว่าเครื่องได้รับ** เมื่อผล provider ไม่แน่นอนอาจคืน `delivery_unknown_or_in_progress`; ไม่คืน capability; unknown ID ตอบ 404
- Global 60 requests/minute และ 4 concurrent รวม Ack/receipt; URL public ต้องใช้ HTTPS reverse proxy ที่ปิด Authorization/body/access logs และส่งต่อ path ตรงกับ base URL ที่ตั้งไว้ ห้ามใส่ application API key ใน APK หรือ FCM data อย่าเปิด listener ต่ออินเทอร์เน็ตตรง ๆ

Body Ack รองรับ `client_action_id` แบบ UUID เพิ่มเติมเพื่อให้ Android ใช้ action เดิมเมื่อ retry; Node bridge นี้เก็บ metadata ของ canonical Ack แรก ไม่ใช่ event-history dashboard การนับ action ข้ามหลายเหตุการณ์ทำต่อใน Go/PostgreSQL โดยไม่ใช้จำนวน HTTP retries เป็นจำนวนครั้งที่กด

Capability ตรวจจาก header/path ก่อนอ่าน body และก่อนใช้ quota ของคำขอที่ยืนยันสิทธิ์แล้ว Invalid traffic แยก quota และปิด connection จึงไม่ใช้ budget ส่งเตือนของ caller ที่ถูกต้อง แต่ยังต้องมี reverse-proxy/network rate limits ก่อนเปิดสู่ภายนอก

### Response/error

| HTTP | ความหมาย |
|---|---|
| 202 | FCM accepted; ไม่มีหลักฐานว่าเครื่องได้รับ/ส่งเสียง |
| 400 | JSON/schema/header key ไม่ถูกต้อง |
| 401 | Bearer key ไม่ถูกต้อง |
| 404 | route/method ไม่รองรับ |
| 409 | key เดิม body ต่าง, request เดิมกำลังส่ง/ไม่ทราบผลหลัง restart, หรือ alert ID ถูกจองแล้วโดย key อื่น |
| 413 / 415 | body ใหญ่เกิน / ไม่ใช่ JSON |
| 422 | title/message/id/TTL ไม่ผ่าน หรือ `payload_too_large` |
| 429 | เกิน 60 requests/minute หรือ 4 งานพร้อมกัน; `Retry-After:60` |
| 502 | provider ปฏิเสธ หรือ `delivery_unknown` หาก timeout/ผลไม่ชัดเจน |
| 503 | ยังไม่ตั้ง FCM, state เต็ม/เขียนไม่ได้ หรือสถานะส่งบันทึกไม่ได้ |

## Idempotency และความไม่แน่นอน

- บันทึก reservation ก่อนยิง provider และบันทึกผลตอบกลับหลัง provider accepted เท่านั้น ไม่บันทึก success ล่วงหน้า
- Key เดิมและ normalized body เดิมคืน response เดิม ไม่ส่งใหม่; body ต่างตอบ 409; ID เดิมกับ key ใหม่ตอบ 409 และไม่หมุน capability แม้ TTL ส่ง FCM หมดแล้ว
- ถ้า provider/network timeout อาจส่งถึงแล้วแม้ตอบ `delivery_unknown` **ไม่สร้าง key ใหม่ทันทีเพื่อพยายามซ้ำโดยไม่เข้าใจความเสี่ยง** ใช้ alert ID เดิมเพื่อลดโอกาสปลุกซ้อน และตรวจที่เครื่องก่อน
- ถ้า process หยุดหลัง reserve ก่อนบันทึกผล request เดิมจะถูกกั้นด้วย `delivery_unknown_or_in_progress` ไม่ resend เอง
- ผล provider rejection ก็ถูกจำไว้ ไม่มี auto-retry หากตรวจยืนยันแล้วว่าไม่ส่งถึงและจะแก้ config ส่งใหม่ ต้องใช้ key ใหม่อย่างตั้งใจ
- Idempotency เก็บ 24 ชั่วโมง สูงสุด 5,000 records หลัง retention key อาจใช้ส่งใหม่ได้ ห้ามใช้เป็น permanent incident ledger; Ack ledger แยกไฟล์ เก็บ hash ของ capability และ `importance` ตาม alert ID สูงสุด 5,000 records **ไม่หมดอายุ/ไม่ลบ unacked เงียบ ๆ**; GET detail อ่าน mode จาก ledger หลัง idempotency record หมดอายุ 24 ชั่วโมง (provider status อาจกลายเป็น `delivery_unknown_or_in_progress`). Legacy ledger ไม่มี mode อ่านเป็น critical; เมื่อ idempotency record normal ยังอยู่ ระบบ backfill mode ลง ledger ก่อนรับคำขอเพื่อไม่ให้หายหลัง pruning. Ledger ที่มี mode ไม่ถูกต้องทำให้ startup ล้มเหลว; เมื่อเต็มให้ 503 จนผู้ดูแลจัดการ retention/archival อย่างตั้งใจ (ยังไม่มี tooling prune)
- Crash window: idempotency reservation เขียนก่อน Ack reservation และทั้งสองต้อง durable **ก่อนส่ง provider**; หาก Ack write ล้มเหลว request ไม่ถูกส่ง และ key เดิมค้าง `delivery_unknown_or_in_progress` เพื่อ fail closed; หาก process ตายระหว่างสองไฟล์ก็เช่นกัน ห้ามลบ state เพื่อ retry อัตโนมัติ; startup ตรวจหา idempotency records ที่เปิด Ack แต่ ledger หาย และปฏิเสธ startup; อย่าปิด Ack config ระหว่างยังมี records ดังกล่าว
- `ackEnabled` ถูก mark หลัง Ack ledger จองสำเร็จแบบ durable เท่านั้น จึงไม่ทำให้ reservation ที่เขียน Ack ไม่สำเร็จล็อก startup ไปตลอด; GET receipt อ่านผ่าน serialized queue เพื่อไม่แสดง tentative Ack ก่อน persist ผ่าน
- ไฟล์ไม่เก็บ API key/private key/device token หรือเนื้อหาข้อความ ใช้ hash ของ key/body และ metadata/ผลแบบย่อ
- Atomic file replacement + flush ลดโอกาส state เสีย แต่ไม่รับประกัน durability เมื่อ OS/disk เสียทุกกรณี **ห้ามรันหลาย process ใช้ state path เดียวกัน** ไม่มี cross-process lock/database transaction
- อย่าลบ `.data` เพื่อแก้ 409 โดยไม่ตรวจเหตุการณ์จริง เพราะอาจส่งซ้ำ เปิดสิทธิ์ filesystem เฉพาะ service user และสำรองอย่างเหมาะสม

HTTP loopback ใช้สำหรับทดสอบในเครื่องเท่านั้น หากระบบต้นทางอยู่เครื่องอื่น ให้ต่อผ่าน HTTPS reverse proxy ที่เชื่อถือได้ ปิดการ log Authorization/body/token ตั้ง firewall และป้องกัน brute-force เพิ่ม อย่า forward port นี้สู่อินเทอร์เน็ตตรง ๆ

## ตรวจสอบ

```powershell
node --test .\server\test\*.test.mjs
```

Tests ใช้ fake sender และ loopback ไม่ส่ง FCM จริง ไม่ถือเป็นหลักฐานว่า Pixel ได้รับหรือได้ยินเสียงหรือว่า public URL ใช้งานได้ ต้องยืนยัน HTTPS proxy, Pixel/network routing และทดสอบ Ack sync จริงแยกต่างหากก่อนเปิด retry/escalation
