# API สำหรับ service อื่นส่งแจ้งเตือน

## 1. มี API แล้ว แต่ยังไม่ใช่ production URL

Go backend มี `POST /v1/alerts` สำหรับ service ภายนอกเรียก ปัจจุบันใช้ Go + PostgreSQL และเตรียมรับฐานจริงที่ผู้ใช้จัดหา โดยทดสอบ local ด้วย embedded PostgreSQL ก่อน ไม่ต้อง deploy dashboard เพื่อให้ endpoint นี้ทำงาน Dashboard เป็นเพียงหน้าดูประวัติ ไม่ใช่ปลายทางรับคำสั่งแจ้งเตือน

การกลับมาใช้ PostgreSQL คือเปลี่ยน **ที่เก็บประวัติ** เท่านั้น ยังใช้ Firebase Cloud Messaging (FCM) ส่ง push เข้า Android เหมือนเดิม ไม่ต้องสร้าง Firestore database ตามแนวทางรุ่นก่อน และไม่ลบ/ปรับ Firebase project เดิมเอง

เส้นทางที่ต้องทดสอบจริงภายหลังคือ `service → Go API → PostgreSQL reservation → FCM → Pixel → ผู้ใช้กด Ack ในเครื่อง → offline queue → HTTPS Go API → ประวัติ PostgreSQL`

**ยังไม่มี public HTTPS URL และยังไม่ยืนยัน Pixel Ack→Go/PostgreSQL จริง** ผลที่ Pixel ดังจริงครั้งก่อนมาจาก Node bridge เดิม ไม่ใช่หลักฐานของ Go end-to-end ตัวอย่าง `https://api.example.org` ข้างล่างเป็น placeholder ไม่ใช่ URL ที่ใช้งานได้

## 2. Request และสิทธิ์

```http
POST /v1/alerts
Authorization: Bearer <APPLICATION_API_KEY>
Idempotency-Key: cabinet-001:off:20261020:incident-001
Content-Type: application/json

{
  "alert_id": "cabinet-001-off-20261020-incident-001",
  "title": "ตู้ 001 ปิดนานเกินกำหนด",
  "message": "ตรวจพบสถานะ OFF ต่อเนื่องตามเงื่อนไขที่ตั้งไว้ กรุณาตรวจสอบตู้",
  "ttl_seconds": 300,
  "importance": "critical"
}
```

| Field/header | เงื่อนไข |
|---|---|
| `Authorization` | application Bearer key ของ service เก็บใน secret store/env ฝั่ง server ไม่ใส่ frontend/แชต/source control |
| `Idempotency-Key` | บังคับ 1–128 ตัว ASCII `A-Z a-z 0-9 _ . : -`; key เดิมตลอดการ retry ของเหตุการณ์เดียว |
| `alert_id` | optional; ถ้าส่งเองต้อง 1–100 ตัว ASCII ตัวอักษร/เลข/underscore/hyphen ใช้ ID เดิมของ incident นั้น ไม่ใช่สุ่มใหม่ทุก retry |
| `title` | บังคับ ไม่ว่าง สูงสุด 120 ตัวอักษร |
| `message` | บังคับ ไม่ว่าง สูงสุด 2,000 ตัวอักษร |
| `ttl_seconds` | optional default 300, ช่วง 30–10,800 วินาที เป็นเวลาที่เริ่มเสียงได้ล่าสุด **ไม่ใช่ระยะเวลาหยุดเสียง** |
| `importance` | optional `normal` หรือ `critical` เท่านั้น; ไม่ส่ง = `critical` เพื่อคงพฤติกรรมเดิม ไม่รับ null/ค่าว่าง/ค่าอื่น |

### ระดับความสำคัญและโหมดเงียบ

- `normal` (**ธรรมดา · เงียบ**): แสดง notification ผ่าน channel เงียบแยก ไม่เล่นเสียง ไม่สั่น ไม่เปิดหน้าปลุก/full-screen และไม่เริ่ม foreground alarm service หากมี critical กำลังดังอยู่ normal จะไม่หยุดหรือเปลี่ยนเสียงของ critical นั้น
- `critical` (**วิกฤต · ปลุก**): พฤติกรรมเดิม เสียงปลุกต่อเนื่องจนคนกดรับทราบเอง TTL ไม่ตัดเสียงที่เริ่มแล้ว และตู้กลับ ON ไม่ auto-Ack
- ระดับนี้เป็น business importance ไม่ใช่ FCM delivery priority: normal ใช้ FCM `NORMAL` จึงอาจถูกหน่วงใน Doze/background; critical ใช้ `HIGH` แต่ยังไม่รับประกันว่าจะดังในทุกสถานะ Android
- ต้องติดตั้ง APK รุ่นที่รองรับ importance ก่อนใช้งาน normal บนมือถือจริง รุ่นแนะนำปัจจุบันคือ `0.6.0-safety-poc`/versionCode 6 ซึ่งป้องกัน remote terminal หยุด critical ด้วย การเพิ่ม field ฝั่ง server เพียงอย่างเดียวไม่ทำให้ APK เก่ารองรับโหมดเงียบ และการทดสอบ JVM/browser ไม่ยืนยันเสียงจริงบน Pixel
- เพื่อไม่ให้ APK เก่าเก็บ normal เป็น alarm ฝั่ง FCM data ใช้ `type=notice` สำหรับ normal และคง `type=alert` สำหรับ critical เครื่องเก่าที่ไม่รู้จัก notice จะข้ามรายการนั้นจนกว่าจะอัปเดต APK
- ใช้ `Idempotency-Key` เดิมกับ importance เดิมตลอด retry การเปลี่ยน normal/critical ของ request เดิมเป็น body conflict ไม่ใช่คำสั่งเปลี่ยนเสียงระหว่าง incident
- request เก่าที่ไม่ระบุ importance และ request ที่ระบุ `critical` ชัดเจนมีความหมายเดียวกัน ประวัติเก่าที่ไม่มีระดับจะอ่านเป็น critical ไม่เปลี่ยนเป็นเงียบย้อนหลัง

ตัวอย่าง normal (ใช้ key/ID ของ **incident ใหม่** ไม่ใช่ retry ของตัวอย่าง critical ข้างบน):

```json
{
  "alert_id": "cabinet-001-info-20261021-001",
  "title": "ข้อมูลตู้ 001",
  "message": "บันทึกสถานะตามรอบ ไม่ต้องปลุก",
  "ttl_seconds": 300,
  "importance": "normal"
}
```

รองรับ JSON เท่านั้น ไม่รับ field ที่ไม่รู้จักหรือ explicit null; body สูงสุด 16,384 bytes และ FCM payload ที่รวมข้อความ/ID/expiry/capability URL ต้องไม่เกิน 4,000 UTF-8 bytes ดังนั้นข้อความยาวที่ผ่านจำนวนตัวอักษรยังอาจเกิน byte budget ได้

Target ปัจจุบันเป็น Pixel ตัวเดียวตาม `FCM_DEVICE_TOKEN` ใน backend ไม่รับ token/target หลายเครื่องจาก request อย่าส่ง `device_token` หรือ `target` เพิ่มเองเพราะไม่อยู่ใน schema

PowerShell ตัวอย่าง (เป็นเอกสารเท่านั้น อย่าเรียกกับระบบจริงโดยไม่ตั้งใจ):

```powershell
$base='https://api.example.org' # เปลี่ยนเป็น URL ที่ deploy/ตรวจ TLS แล้ว
$headers=@{
  Authorization="Bearer $env:NOTIFY_API_KEY"
  'Idempotency-Key'='cabinet-001:off:20261020:incident-001'
}
$body=@{
  alert_id='cabinet-001-off-20261020-incident-001'
  title='ตู้ 001 ปิดนานเกินกำหนด'
  message='ตรวจพบ OFF ต่อเนื่องตามเวลาที่ตั้งไว้ กรุณาตรวจสอบ'
  ttl_seconds=300
  importance='critical'
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri "$base/v1/alerts" -Headers $headers `
  -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

ระหว่าง local synthetic demo API `127.0.0.1:8791` ใช้ **fake sender** การได้ 202 ไม่ได้ทำให้มือถือดัง ห้ามสรุปว่าได้ทดสอบ FCM จริงจากตัวอย่างในโหมดนี้

## 3. Response / retry ที่ผู้เรียกต้องจัดการ

ตัวอย่าง 202 (เวลาเป็นตัวอย่าง ไม่ใช่หลักฐานส่งจริง):

```json
{
  "alert_id": "cabinet-001-off-20261020-incident-001",
  "status": "provider_accepted",
  "expires_at": "2026-10-20T03:05:00Z",
  "acknowledged": false,
  "delivery_verified": false
}
```

`acknowledged:false` ในผล POST เป็น submission receipt ไม่ใช่การ poll สถานะ Ack ล่าสุด หาก replay หลังคนรับทราบแล้วก็ยัง replay receipt เดิม ให้เรียก GET รายละเอียดเพื่ออ่านสถานะปัจจุบัน

| HTTP | ความหมาย / การทำงานของ caller |
|---|---|
| 202 `provider_accepted` | FCM provider รับคำขอ ไม่ยืนยันโทรศัพท์ได้รับหรือส่งเสียง และไม่ใช่ Ack ของคน |
| 400 / 413 / 415 / 422 | schema/query/size/content-type ผิด แก้ request ก่อน ไม่ retry แบบไม่เปลี่ยนอะไร |
| 401 | application key ผิด แก้ config ไม่วนยิงถี่ |
| 409 | key/body หรือ alert ID ขัดแย้ง หรือ reservation เดิมค้างผลไม่แน่นอน ตรวจประวัติ/แจ้ง operator ไม่เปลี่ยน key/ID เพื่อบังคับส่งซ้ำเอง |
| 429 | quota/concurrency รอ `Retry-After` แล้ว retry request เดิม |
| 502 `provider_failed` / `delivery_unknown` | provider ปฏิเสธหรือไม่ทราบว่าส่งสำเร็จหรือไม่ ไม่ถือว่ามือถือไม่เคยรับ และไม่ส่ง incident ใหม่อัตโนมัติ |
| 503 | database/config/state ไม่พร้อม ใช้ backoff และ key/body/ID เดิม พร้อมจำกัด retries และแจ้ง operator ถ้าเกินเวลา |
| timeout / connection error | ไม่รู้ว่า server commit/send ไปแล้วหรือยัง retry เฉพาะ request เดิมด้วย key เดิม ห้ามสร้างเหตุการณ์ใหม่เพราะ timeout |

key เดิม + normalized body เดิม replay ผล canonical และมี `Idempotency-Replayed: true` ไม่ส่ง provider ซ้ำ ผล failed/unknown ที่บันทึกแล้วไม่เปลี่ยนเป็นการส่งรอบใหม่เอง `delivery_unknown` ที่ reservation ยังไม่เสร็จอาจเป็น 409 ขณะที่ unknown ที่บันทึกผลเสร็จแล้ว replay เป็น 502

เมื่อ TTL ของ incident เดิมหมด อย่าเพียงเปลี่ยน `ttl_seconds` แล้วใช้ key เดิม เพราะ body เปลี่ยนจะ conflict การแจ้งเหตุการณ์ใหม่/ยกระดับเหตุการณ์เดิมเป็นการตัดสินใจของ business logic/operator ไม่ใช่ network retry

## 4. ดูผลและ Ack

service ที่มี application key อ่าน `GET /v1/alerts/{id}`, `GET /v1/history`, `GET /v1/stats` ได้ ผล provider และสถานะ Ack แยกจากกัน แม้มี Ack ก็ไม่เปลี่ยน `status` ของ provider เดิม

`POST /v1/alerts/{id}/ack` ใช้ **per-alert capability** จาก FCM เท่านั้น application key ใช้ Ack ไม่ได้ มือถือใช้ `client_action_id` UUID หนึ่งตัวต่อการกด Ack-all หนึ่งครั้ง ส่ง UUID เดิมให้ทุก alert ในชุดและ retry จน server ยืนยัน ไม่เพิ่มจำนวนการกดเพราะ retry

Alarm หยุดในเครื่องเมื่อคนกดรับทราบ ไม่รอ network/ฐานข้อมูล การกลับ ON ของตู้ไม่ใช่การกดของคน ห้าม service ส่ง Ack แทนหรือสั่งหยุดเสียงอัตโนมัติเมื่อสถานะตู้ฟื้นกลับ และ service ต้นทางต้องใช้สถานะ/การวัดที่ได้รับจริง ไม่อนุมานว่า unknown/default 0 เป็นเหตุไฟดับ

## 5. ก่อนเชื่อม PostgreSQL ที่ผู้ใช้จัดหา

- ส่งเฉพาะข้อมูลที่ไม่ใช่ secret เช่น version, hosting, host/port/database และ TLS requirement ได้ รหัสผ่าน/connection string ที่มีรหัสให้เก็บในไฟล์ส่วนตัวหรือ secret store แล้วแจ้ง **path** ไม่ส่งค่าลงแชต
- `DATABASE_URL` ใช้กับ Go production runtime ไม่ใช่ Next และไม่ใช่ browser Go ไม่โหลด `.env` ให้อัตโนมัติ ใช้ environment ที่จัดการอย่างปลอดภัย เช่นอ่านไฟล์ส่วนตัวเข้า process env โดยไม่พิมพ์ค่า
- ใช้ TLS ตรวจ hostname/CA ตามผู้ให้บริการ เช่น lib/pq `sslmode=verify-full` และ `connect_timeout=10`; อย่าเปลี่ยนเป็น `sslmode=disable` สำหรับ remote database เพื่อให้ทดสอบผ่าน
- database ต้องเป็น **UTF8** ตรวจ `SHOW server_encoding` ได้ Backend ตรวจและปฏิเสธ encoding อื่นก่อน auto-migrate ไม่แปลง encoding หรือแก้ข้อมูลฐานเดิมให้เอง ส่วน embedded tests/demo ระบุ UTF8 ตอน initdb โดยตรง ไม่ใช้ WIN874 ตาม locale ของ Windows
- startup auto-migrate ต้องมีสิทธิ์สร้าง/เพิ่มตาราง/index/column ตาม migration ที่มีอยู่ วางแผน backup/permission ก่อนใช้งานจริง เป็น SQL idempotent migration ปัจจุบัน ไม่ใช่ระบบ rollback/version runner เต็มรูปแบบ
- การทดสอบฐานจริงอาจสร้าง schema และเขียนข้อมูล จึงต้องเลือก database/schema สำหรับระบบนี้และอนุมัติก่อนเชื่อม ไม่ใช้ฐานงานอื่นโดยเดาเอง
- embedded PostgreSQL ใช้เฉพาะ tests/demo; production persistence/backup อยู่ที่ PostgreSQL ภายนอก ไม่อยู่ใน API pod และไม่ต้องมี embedded binary ใน image
- ตั้ง FCM credential/token และ HTTPS `ACK_PUBLIC_BASE_URL` หลังทดสอบ local ผ่าน แล้วตรวจจริงหนึ่ง incident / หนึ่ง human Ack / retry เดิม พร้อมเทียบประวัติ ไม่เปิด production dashboard ภายนอกโดยยังไม่มี authentication
- `.github/workflows/api-ci.yaml` ใช้ push เข้า `main` เป็น build หลัก, ตรวจ PR เข้า `main` และเลือก manual run ได้ โดย push/PR กรอง Go/workflow/Docker paths ทดสอบ Go แล้ว build `Dockerfile.go` จาก repository root ด้วย `Dockerfile.go.dockerignore` เท่านั้น **ไม่ push GHCR และไม่ deploy** ไม่มี staging deployment; ผล build-only รุ่นก่อนผ่านบน GitHub แต่ workflow ที่เปลี่ยนชื่อนี้ยังไม่ได้รัน ห้ามตีความการมี workflow ว่ามี production URL แล้ว

รายละเอียด UI/เวลา/การนับดู [dashboard PostgreSQL](dashboard-local-th.md) ส่วน Node bridge เดิมยังเป็น baseline แยก ไม่มีการย้ายประวัติหรือเปลี่ยน service จริงโดยอัตโนมัติ
