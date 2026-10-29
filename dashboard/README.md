# Notify operations console

Next 16 / React 19 / CSS เดิม ไม่มี UI kit หรือ dependency เพิ่ม บัญชีผู้ดูแลหนึ่งบัญชี ไม่มี signup/reset/email เปิดอ่านประวัติและส่งทดสอบได้หลัง login และเปลี่ยนรหัสผ่านเริ่มต้นสำเร็จเท่านั้น

## เริ่มใช้งานและการตั้งค่าฝั่งเซิร์ฟเวอร์

ใช้ Node 22 และ pnpm **10.33.0**: `pnpm install --frozen-lockfile`, `pnpm dev` (127.0.0.1:3010), `pnpm test`, `pnpm exec next typegen`, `pnpm typecheck`, `pnpm build`, `pnpm start` ห้ามใช้ production credential/provider ระหว่างพัฒนา การ build ไม่ต้องติดต่อ backend

| ตัวแปร | ความหมาย |
|---|---|
| `DASHBOARD_PUBLIC_URL` | **จำเป็น** canonical origin เช่น `https://console.example` ไม่มี path/query/fragment/credentials; HTTP อนุญาตเฉพาะ `http://127.0.0.1:3010`, `http://localhost:3010` หรือ IPv6 loopback ที่ตั้งตรงกับ URL ที่ผู้ใช้เปิดจริง |
| `BACKEND_URL` | server-only origin ค่าเริ่มต้น `http://127.0.0.1:8791`; HTTPS หรือ HTTP loopback เท่านั้น เว้นแต่ allowlist ด้านล่าง |
| `BACKEND_ALLOWED_HTTP_ORIGINS` | comma-separated **exact HTTP origins** สำหรับ internal service เช่น `http://backend:8791`; ไม่รับ wildcard, credentials, path, query หรือ fragment; port ต้องตรง |
| `BACKEND_API_KEY_FILE` | ไฟล์ server-held app key มีลำดับก่อน `BACKEND_API_KEY` |
| `BACKEND_API_KEY` | ตัวเลือกสำรอง server-held app key; ห้ามใช้ `NEXT_PUBLIC_` หรือให้ browser กรอก |
| `DASHBOARD_DEMO_MODE=true` | แสดงป้ายข้อมูลสาธิต ไม่สร้าง fixture/ไม่ bypass auth/ไม่ซ่อน API errors |

ห้ามนำค่าจริงเข้า repository หรือ log Browser ไม่ได้รับ app key, session token JSON, Ack capability หรือ cookie ดิบของ service อื่น BFF ส่งเฉพาะ session ของตนผ่าน `X-Dashboard-Session` ไป fixed `/v1/dashboard/...` พร้อม server app key ไม่รับ URL จาก request ไม่ตาม redirect จำกัด upstream 10 วินาที/1 MiB และ project response DTO

### TLS termination / Host policy

ต้อง preserve public `Host` ให้ตรง canonical origin BFF ไม่เชื่อ `X-Forwarded-Host`/`X-Forwarded-Proto` ที่ผู้เรียกกำหนด ค่า `request.url` ภายในอาจเป็น `http://0.0.0.0:3000` แม้ public ใช้ HTTPS: ไม่ reject เพียงเพราะ internal scheme ต่างกัน แต่ยังตรวจ Host และ Origin กับ canonical HTTPS โดยตรง ไม่มี `NODE_ENV` bypass ไม่มี insecure public HTTP exception การตั้งค่าขาดหรือผิดเป็น 503/หน้าระบบไม่พร้อม ไม่เปิดข้อมูลให้ผ่าน

Public HTTPS ใช้ host-only `__Host-notify_session; Secure; HttpOnly; SameSite=Lax; Path=/` และ Max-Age ไม่เกิน expiry ของ Go (สูงสุด 24 ชั่วโมง) เฉพาะ explicit loopback HTTP ใช้ `notify_session_local` ไม่มี Secure เพื่อทดสอบ standalone จริงได้ Logout และ session 401 ลบ cookie ไม่มี token ใน localStorage หรือ redirect URL มีเพียง `notify-theme` ซึ่งไม่ใช่ความลับใน localStorage

## Browser API (same-origin เท่านั้น)

ทุก mutation รวม login/logout ต้องมี `Origin` ตรง canonical origin, `Content-Type: application/json`, `X-Notify-Request: dashboard` Browser กำหนด Origin อัตโนมัติ integration test ต้องส่งเอง ไม่มี credentialed wildcard CORS

| Method / path | Body/query และผลลัพธ์ |
|---|---|
| `POST /api/auth/login` | `{username,password}` ทั้งคู่ string → 200 auth DTO ด้านล่าง; ไม่ต้องมี session |
| `GET /api/auth/session` | ไม่มี body/query → 200 auth DTO; session ชั่วคราวใช้ได้ |
| `POST /api/auth/change-password` | `{current_password,new_password}` → 200 auth DTO พร้อม cookie ที่ rotate แล้ว; session ชั่วคราวหรือเต็มใช้ได้ |
| `POST /api/auth/logout` | browser ส่ง `{}`; ไม่ forward body ไป Go → 200 `{ok:true}` แม้ session ไม่มี/ไม่ถูกต้อง; ลบ cookie |
| `GET /api/history` | ต้อง full session; query `from,to` UTC RFC3339 Z แบบ [from,to), `status` default `all` (`provider_accepted`, `provider_failed`, `delivery_unknown`, `acknowledged`, `pending_ack`), `limit` 1–25 default25, `cursor` opaque≤2048; 200 `{items:AlertSummary[],next_cursor:string|null}` |
| `GET /api/stats` | ต้อง full session; query `from,to` เหมือน history แต่ **ไม่มี status**; 200 stats DTO ด้านล่าง |
| `GET /api/alerts/{id}` | ต้อง full session; id `[A-Za-z0-9_-]{1,100}` ไม่มี body/query; 200 detail DTO ด้านล่าง |
| `POST /api/test-alerts` | ต้อง full session; header `Idempotency-Key` `[A-Za-z0-9_-]{16,128}`; body allowlist `alert_id,title,message,ttl_seconds,importance` เท่านั้น; 202 `{alert_id,status}` ที่ project แล้ว |

Auth DTO เท่านั้น (ตัด `session_token` และ field เกินทั้งหมด):
```json
{"user":{"username":"admin","must_change_password":true},"expires_at":"2026-10-30T00:00:00Z"}
```
`username` เป็นชื่อบัญชี string, `must_change_password` เป็น boolean; true ใช้ได้เฉพาะ auth/session/change/logout ไม่เปิดประวัติหรือส่งทดสอบ `expires_at` เป็นเวลา expiry UTC ของ session เปลี่ยนรหัสต้องอย่างน้อย **15 Unicode characters และไม่เกิน 128 UTF-8 bytes** และต่างจากเดิม สำเร็จแล้ว session อื่นถูก revoke

ตัวอย่างคำขอส่งแบบเงียบ:
```json
{"alert_id":"synthetic-example-id","title":"ทดสอบ","message":"ข้อความตัวอย่าง","ttl_seconds":300,"importance":"normal"}
```
ทุก field จำเป็นใน BFF: title 1–120/message 1–2000 Unicode characters ไม่ใช่ whitespace ล้วน; TTL integer30–10800 วินาที ฟอร์ม default300; importance explicit `normal` หรือ `critical` ไม่ใช้ critical default ของ API เก่า Go ตรวจขนาด payload bytes อีกชั้น เป้าหมายคืออุปกรณ์ที่ตั้งค่าไว้บนเซิร์ฟเวอร์ ไม่รับ FCM token จาก browser

### ประวัติและรายละเอียด

AlertSummary: `alert_id,title,message,status,importance,created_at` เป็น string; `importance` คือ normal/critical; `provider_accepted_at,expires_at,acknowledged_at,last_ack_at` เป็น UTC timestamp หรือ null; `ack_count` เป็น integer≥0 หรือ null Detail เพิ่ม `ack_actions` array ของ `{client_action_id:string,client_acked_at:timestamp|null,received_at:timestamp}` โดย received_at คือ server time client_acked_at เป็นเวลาอุปกรณ์ อาจคลาดเคลื่อน รายการว่าง: `{"items":[],"next_cursor":null}` ห้ามสร้าง total pages

Stats: `total_alerts,provider_accepted,provider_failed,delivery_unknown,acknowledged,pending_ack,ack_action_count` เป็น integer≥0 หรือ null ไม่มี field totals เพิ่มเอง ack_action_count นับ client_action_id ไม่ซ้ำข้ามเหตุการณ์ ไม่ใช่ผลรวม ack_count รายเหตุการณ์ null คือไม่ทราบ ไม่ใช่ศูนย์

วันที่หน้าเว็บเป็น Asia/Bangkok แปลงเป็น UTC exclusive end ของวันถัดไป เวลาแสดง พ.ศ./UTC+7 การเปลี่ยนสถานะกรองเฉพาะรายการ ไม่เปลี่ยนขอบเขต stats และใช้ next_cursor ต่อด้วย filter เดิม

### ข้อผิดพลาดและการรับมือ

ทุก error เป็น `{error: "ข้อความภาษาไทยที่ควบคุมไว้", code: "exact_code"}` ไม่ส่ง raw backend body ตัวอย่าง 401: `{"error":"กรุณาเข้าสู่ระบบ","code":"session_required"}`

| HTTP / code | Browser action |
|---|---|
| 401 `session_required` | cookie ถูกลบ ไป `/login` |
| 403 `password_change_required` | ไป `/change-password` หยุดอ่าน/ส่ง |
| 401 `invalid_credentials` | แสดงชื่อผู้ใช้/รหัสผ่านไม่ถูกต้อง ไม่มีรายละเอียดบัญชี |
| 400 `invalid_schema` | ตรวจ body/query ไม่ส่ง field เกิน |
| 422 `invalid_password`, `password_unchanged` | แก้รหัสผ่านตามข้อจำกัด/อย่าใช้รหัสเดิม |
| 403 `invalid_origin` | ตรวจ same-origin/required headers ไม่ retry provider |
| 429 `rate_limited` | เคารพ `Retry-After` เมื่อมี ไม่มี automatic retry ส่งแจ้งเตือน |
| 503 `dashboard_not_configured`, `temporarily_unavailable`, `server_configuration` | แสดงไม่พร้อมใช้งาน ห้าม bypass; Go app-key `unauthorized` ถูกแปลงเป็น 503 server_configuration ไม่ใช่ session หมด |
| 404 `not_found` | ยังไม่พบประวัติ/ตรวจรหัส ไม่อ้างว่าไม่เคยส่ง |
| 409 `alert_id_conflict`, `idempotency_conflict`, `delivery_unknown_or_in_progress` | ตรวจประวัติก่อน ไม่สร้างรหัสใหม่อัตโนมัติ |
| 422 `invalid_message`, `invalid_alert_id`, `invalid_ttl`, `invalid_importance`, `payload_too_large` | แก้ input ตามข้อกำหนด เซิร์ฟเวอร์เป็นผู้ตัดสินสุดท้าย |
| 502 `provider_delivery_unknown`, `provider_rejected`, `provider_authentication_failed`, `expired_before_send`, `upstream_error` หรือ 503 `delivery_state_unavailable` | ไม่ยืนยันอุปกรณ์ได้รับ ตรวจประวัติก่อน retry |

Raw/unrecognized upstream error ถูกแทนด้วย `upstream_error` ไม่เปิดรายละเอียดลับ การส่ง timeout/unknown ไม่สร้าง ID ใหม่เอง Retry ที่ผู้ใช้เลือกใช้ payload/alert_id/idempotency key เดิมทุกครั้ง การกดส่งเหตุการณ์ใหม่เป็น human action ใหม่ใช้ ID ใหม่ ไม่มีปุ่ม fake Ack

## UI / adoption checklist

- routes เดิมเปลี่ยนจาก localhost-only เป็น full-session ทุก SSR/data path; caller เดิมต้อง login/เปลี่ยนรหัสก่อน ไม่มี public compatibility bypass
- ส่ง critical ต้องยืนยัน dialog เสียงต่อเนื่องจนคนกดรับทราบ TTL **ไม่ใช่เวลาหยุดเสียง**
- provider accepted ไม่เท่ากับโทรศัพท์ได้รับ/ส่งเสียง; unknown ไม่เท่ากับ failed; ไม่มีรายงานแตะไม่พิสูจน์ว่าอุปกรณ์ไม่เคยได้รับ
- หลังส่งดู detail ทุก4วินาที สูงสุด30ครั้ง หยุดเมื่อมี Ack/หมด session; แสดงเวลา server และ client แยกกัน ไม่มีรายงาน online/offline/identity ที่ API ไม่ได้ให้
- ธีม dark/light/system, keyboard focus/return, reduced motion และ mobile CSS มีแล้ว แต่ visual acceptance/contrast measurement/browser integration ยังต้องตรวจแยก ไม่อ้างผ่านจาก build
- ตรวจ loading/empty/error/stale/demo labels, cursor pagination, expired session, critical cancel/confirm, uncertain-send retry และ account/logout ใน browser ด้วย synthetic backend เท่านั้นก่อนทดสอบอุปกรณ์จริงที่ต้องอนุมัติแยก
