# บัญชีเดียว หลายอุปกรณ์ — สัญญาสำหรับ Android และ Dashboard

> สัญญาสำหรับการใช้งานฝั่ง client ไม่ใช่การยืนยันว่า production เปิดใช้แล้ว การลงทะเบียน/provider acceptance ไม่ใช่หลักฐานว่ามือถือได้รับหรือส่งเสียง

## 1. ขอบเขตและคำที่ต้องแยก

- เจ้าของหนึ่งบัญชี ใช้ **username/password เดียวกัน** ได้หลายเครื่อง แต่แต่ละการติดตั้งมี session ของตัวเอง ไม่มี signup หรือ email login เพิ่มในรุ่นนี้
- `key_id` เป็นตัวระบุปลายทางที่บัญชีได้รับอนุญาต ไม่ใช่ secret ของ application API key รุ่นนี้มี key ที่ตั้งค่าไว้หนึ่งชุด ใช้ public ID `primary` ยังไม่มีหน้าสร้าง key เพิ่ม
- Application Bearer API key ใช้โดยระบบส่งเท่านั้น ห้ามใส่ใน APK, browser, URL หรือ log
- `installation_id` เป็น UUID ของการติดตั้งแอป สร้างครั้งเดียว ไม่ใช้ hardware ID; `device_id` เป็น UUID ที่ server กำหนดให้ทะเบียนอุปกรณ์
- FCM token เป็นข้อมูลอ่อนไหวที่ client ส่งให้ server เพื่อลงทะเบียน ไม่ใช่รหัส login และไม่ใช่หลักฐานว่าเครื่องรับ push สำเร็จ
- หนึ่งคำขอส่ง = หนึ่ง `alert_id` กระจายไปยังอุปกรณ์ที่ได้รับเลือกในขณะสร้างเหตุการณ์ ไม่เพิ่มโทรศัพท์ที่เพิ่งลงทะเบียนเข้าไปในเหตุการณ์เดิมเมื่อ retry
- ส่งกระจายจากคำขอเดียวกัน ไม่รับประกันว่าทั้งสองเครื่องจะได้รับหรือดังตรงวินาทีเดียวกัน
- **ใครกดรับทราบ หยุดเฉพาะเครื่องที่กด** ไม่ส่งคำสั่งหยุดอีกเครื่อง ไม่หยุดเสียงที่เริ่มไปแล้วเพราะ TTL หมด, logout, ยกเลิกทะเบียน หรืออุปกรณ์ต้นเหตุกลับมาปกติ
- ประวัติแยกเครื่องได้ แต่ระบุตัวบุคคลจริงไม่ได้จากบัญชีที่ใช้ร่วมกัน ชื่อเครื่องเป็นชื่อแสดงผล ไม่ใช่หลักฐานยืนยันตัวบุคคล

## 2. Endpoint inventory

### Android เรียก Notify API โดยตรงผ่าน HTTPS

| Method/path | สถานะ | สิทธิ์และหน้าที่ |
|---|---|---|
| `POST /v1/client/login` | ใหม่ | ไม่ต้องมี session; เข้าสู่ระบบและผูก session กับ installation |
| `GET /v1/client/session` | ใหม่ | client Bearer; ตรวจบัญชี/expiry/สถานะบังคับเปลี่ยนรหัส |
| `POST /v1/client/change-password` | ใหม่ | client Bearer; เปลี่ยนรหัสและรับ token ชุดใหม่ |
| `POST /v1/client/logout` | ใหม่ | client Bearer; ออกจากระบบของ installation นี้และปิดรับรายการใหม่ |
| `GET /v1/client/keys` | ใหม่ | full client session; รายการ public key ID ที่ได้รับอนุญาต |
| `POST /v1/client/devices/register` | ใหม่ | full client session; ลงทะเบียน/อัปเดตเครื่องของ session นี้ |
| `GET /v1/client/devices` | ใหม่ | full client session; อ่านทะเบียนในบัญชี ไม่เปิดเผย FCM token |
| `POST /v1/alerts/{alert_id}/ack` | เปลี่ยน | capability เฉพาะ alert+เครื่อง; body เดิม ไม่มี device ID ให้ client อ้างเอง |

### Browser เรียก same-origin BFF เท่านั้น

| Method/path | สถานะ | สิทธิ์และหน้าที่ |
|---|---|---|
| `GET /api/devices` | ใหม่ | full Dashboard cookie session; ดูทะเบียนอุปกรณ์ |
| `DELETE /api/devices/{device_id}` | ใหม่ | full Dashboard cookie session; ยกเลิกเครื่องหลังยืนยัน |
| `GET /api/alerts/{alert_id}` | เปลี่ยน response | เพิ่มผลรายเครื่องและแหล่งที่มาของ Ack |
| `GET /api/history` | เปลี่ยนความหมายรวม | รูปแบบเดิม แต่ Ack อย่างน้อยหนึ่งเครื่องไม่แปลว่ารับทราบครบ |
| `GET /api/stats` | เปลี่ยนความหมายรวม | รูปแบบเดิม; การแตะนับแยกเครื่องและ dedup retry |
| `POST /api/test-alerts` | เปลี่ยนการกำหนดปลายทาง | body เดิม; กระจายตามทะเบียน ไม่ให้ browser ส่ง FCM token/รายชื่อเป้าหมายเอง |

### เส้นทางสำหรับระบบส่ง / BFF ไม่ใช่ API ที่ APK ใช้ master key เรียก

| Method/path | สถานะ | ผู้เรียก |
|---|---|---|
| `POST /v1/alerts` | เปลี่ยน fan-out | ระบบส่ง ใช้ application key + `Idempotency-Key`; request เดิม |
| `GET /v1/alerts/{alert_id}` | เปลี่ยน response | ระบบส่ง; เพิ่ม `deliveries` และ Ack รายเครื่อง |
| `GET /v1/history`, `GET /v1/stats` | เปลี่ยนความหมายรวม | ระบบส่ง; request/cursor เดิม |
| `GET /v1/dashboard/devices` | ใหม่ | BFF เติม application key และ Dashboard session; browser ห้ามเรียกตรง |
| `DELETE /v1/dashboard/devices/{device_id}` | ใหม่ | BFF ทำการยกเลิกทะเบียนแทน browser |
| `GET /v1/dashboard/alerts/{alert_id}`, `GET /v1/dashboard/history`, `GET /v1/dashboard/stats`, `POST /v1/dashboard/alerts` | เปลี่ยนตามคู่ BFF | BFF เท่านั้น; browser ใช้ `/api/*` |

Web login/session/change-password/logout เดิมเป็น dependency ที่ยังใช้ได้ ดู [Dashboard authentication](fe-dashboard-auth-th.md) client token ของ Android ใช้แทน cookie หรือ application key ไม่ได้

## 3. Transport, auth และข้อผิดพลาด

### Android

- ใช้ HTTPS API base ที่ผู้ใช้ระบุและผ่านการตรวจสอบ ไม่ใส่ username/password ใน URL ไม่ตาม redirect พร้อม token
- `POST` login/change-password/register ใช้ `Content-Type: application/json`; ไม่ส่ง field ที่ไม่รู้จักหรือ explicit `null` แทนค่าที่ต้องระบุ body สูงสุด 16,384 UTF-8 bytes; logout ไม่ต้องมี body และส่ง `{}` ได้
- เส้นทางหลัง login ส่ง `Authorization: Bearer <client-access-token>` ยกเว้น Ack ซึ่งใช้ **Ack capability จากข้อความนั้น**
- response มีข้อมูลอ่อนไหวเฉพาะ `access_token` ตอน login/เปลี่ยนรหัส เก็บเข้าที่เก็บ credential แบบเข้ารหัสของแอป ไม่เก็บรหัสผ่าน ไม่แสดง token ใน UI/log/notification
- `expires_at` เป็น RFC3339 UTC ไม่ใช่เวลาท้องถิ่น; client ต้องตรวจ expiry และตอบสนองต่อ 401 จาก server ไม่ถือว่า token ยังใช้ได้เพียงเพราะมีในเครื่อง
- Session อายุ idle สูงสุด 30 วัน การลงทะเบียนที่สำเร็จต่ออายุการใช้งาน; งานลงทะเบียนเป็นระยะไม่รับประกันว่าจะถูก Android ปลุกตรงเวลา หากหมดอายุต้อง login ใหม่
- Client รับ HTTP 429 ให้เคารพ `Retry-After`; network/503 ใช้ backoff ไม่วนยิงทันที; 401 หยุด retry credential เดิมและให้ login ใหม่

รูปแบบข้อผิดพลาดของ API โดยตรง:

```json
{"error":{"code":"session_required"},"request_id":"synthetic-request-id"}
```

| HTTP/code | ความหมาย / วิธีรับมือ |
|---|---|
| 401 `invalid_credentials` | login ไม่ผ่าน แสดงข้อความรวม ไม่บอกว่าชื่อหรือรหัสผิด |
| 401 `session_required` | session ไม่มี/หมดอายุ/ถูกยกเลิก ไม่ retry เป็น loop |
| 403 `password_change_required` | เปลี่ยนรหัสก่อน keys/registration/อ่านทะเบียน |
| 415 `json_required` | ตรวจ Content-Type |
| 413 `body_too_large` | ลดขนาด body ไม่ retry body เดิม |
| 400 `invalid_schema` | field ไม่รู้จัก/null/JSON ไม่ตรง schema; field ที่ขาดอาจเป็น 422 ตาม validation ของ route |
| 422 validation | แสดง error ให้แก้ค่า ไม่ถือว่าลงทะเบียนแล้ว |
| 429 `rate_limited` | รอตาม `Retry-After` และปิด duplicate submission |
| 503 `temporarily_unavailable` | ยังยืนยันผลไม่ได้ ใช้ backoff/ตรวจสถานะก่อนสรุปผล |

ตัวอย่างสถานะอื่นใช้ envelope เดียวกัน เช่น HTTP 403:

```json
{"error":{"code":"password_change_required"},"request_id":"synthetic-request-id"}
```

ชื่อ validation/error ราย route ให้ตรวจรายการในส่วนนั้น ไม่ถือว่า error ทุกตัวเกิดได้กับทุก route

### Browser

GET ใช้ cookie อัตโนมัติ ไม่ต้องส่ง Bearer; DELETE ต้องมี Origin ตรงหน้าเว็บ, `Content-Type: application/json` และ `X-Notify-Request: dashboard` ไม่มี body

ข้อผิดพลาด BFF เป็น `{ "error": "ข้อความสำหรับแสดง", "code": "session_required" }` ไม่ใช่ envelope ของ Android; 401 ไปหน้า login, 403 `password_change_required` ไปเปลี่ยนรหัส, 403 `invalid_origin` ไม่ retry, 502/503 แสดงไม่พร้อมและอนุญาต refresh

```json
{"error":"กรุณาเข้าสู่ระบบ","code":"session_required"}
```

## 4. เข้าสู่ระบบ — `POST /v1/client/login`

เรียกเมื่อผู้ใช้กด login ไม่เปิดสมัครบัญชีใหม่ ไม่มี application key ใน request

```json
{"username":"admin","password":"synthetic-example-password-only","installation_id":"11111111-1111-4111-8111-111111111111"}
```

| Request key | ชนิด / ข้อกำหนด |
|---|---|
| `username` | string; username เดียวกับ Dashboard, ตรงตัวพิมพ์ |
| `password` | string; รหัสปัจจุบัน ไม่ trim หรือเปลี่ยน Unicode อัตโนมัติ |
| `installation_id` | UUID ของการติดตั้งนี้ ต้องใช้ค่าเดิมเมื่อ retry/re-login ไม่คัดลอก identity ไปอีกเครื่อง |

HTTP 200:

```json
{"access_token":"synthetic-placeholder-not-a-real-access-token","expires_at":"2026-12-08T10:00:00Z","user":{"username":"admin","must_change_password":false}}
```

| Response key | ความหมาย |
|---|---|
| `access_token` | opaque client credential 43 ตัว เก็บแบบเข้ารหัส; ตัวอย่างด้านบนเป็น placeholder ไม่ใช่ token ใช้งานได้ |
| `expires_at` | UTC instant ของ session |
| `user.username` | ชื่อบัญชี ไม่ใช่ชื่อเครื่อง |
| `user.must_change_password` | true ให้เข้า flow เปลี่ยนรหัส ห้ามอ้างว่าลงทะเบียนอุปกรณ์ได้แล้ว |

ผิดรหัสใช้ 401 `invalid_credentials`; 422 `invalid_username`, `invalid_password`, `invalid_installation_id` ต้องแก้ field นั้น Username 3–64 ตัวจาก `A–Z a–z 0–9 _ . -` และ case-sensitive; password ปัจจุบัน 1–128 UTF-8 bytes; installation UUID ต้องเป็นรูป canonical ตัวพิมพ์เล็ก หากระบบยังไม่มีบัญชีอาจเป็น 503 `dashboard_not_configured` การ login สำเร็จยังไม่ใช่ทะเบียน FCM และไม่ยืนยันการรับ push

## 5. Session / เปลี่ยนรหัส / Logout

### `GET /v1/client/session`

ไม่มี body ใช้ client Bearer ตัวอย่าง path `/v1/client/session` HTTP 200:

```json
{"expires_at":"2026-12-08T10:00:00Z","user":{"username":"admin","must_change_password":false}}
```

field เหมือนข้อ 4 แต่ **ไม่คืน access token**; 401 ใช้ flow login ไม่ส่ง token ไป endpoint อื่นเพื่อทดลองสิทธิ์

### `POST /v1/client/change-password`

limited/full client Bearer ใช้ได้:

```json
{"current_password":"synthetic-current-password","new_password":"synthetic-new-password-2026"}
```

`current_password` และ `new_password` เป็น string; รหัสใหม่อย่างน้อย 15 Unicode codepoints ไม่เกิน 128 UTF-8 bytes ไม่ซ้ำรหัสเดิม/รหัสเริ่มต้น UI มีช่องยืนยันเองแต่ไม่ส่ง `confirm` เพิ่ม

HTTP 200 คืน login response ข้อ 4 พร้อม token ชุดใหม่ ต้องแทน credential เดิมอย่างปลอดภัย ไม่ให้ response เก่าทับการ logout/login ครั้งถัดไป Session ของ client อื่นอาจถูกยกเลิกเมื่อเปลี่ยนรหัส จึงต้องรับมือ 401 ไม่ถือว่าทุกเครื่องยัง login อยู่

422 `invalid_current_password` หมายถึง field รหัสปัจจุบันไม่ถูกต้อง; 422 `invalid_password` ให้แก้รหัสใหม่; 422 `password_unchanged` เลือกรหัสใหม่; 401 `invalid_credentials` สำหรับรหัสปัจจุบันไม่ผ่าน และ 401 `session_required` สำหรับ session ไม่ผ่าน ไม่เปลี่ยน local state ว่าสำเร็จ

### `POST /v1/client/logout`

ไม่มี body ใช้ client Bearer HTTP 200:

```json
{"logged_out":true}
```

ยกเลิก session/ทะเบียนของ installation นี้สำหรับรายการใหม่ ไม่ใช่การสั่งหยุดเสียง และไม่ลบประวัติหรือ pending Ack ถ้า offline/timeout ห้ามแสดงว่า server ยกเลิกแล้ว เก็บงานยกเลิกอย่างปลอดภัยและแสดงสถานะรอยืนยัน; ไม่ให้ registration งานเก่าฟื้นทะเบียนระหว่างรอ logout

401 **ไม่ใช่หลักฐานว่าปิดรับ push แล้ว** ให้คงสถานะรอยืนยันและให้ผู้ใช้ยืนยันรหัสผ่านบัญชีเดิมเพื่อจบ logout ของ installation เดิมเท่านั้น หรือยกเลิกเครื่องผ่าน Dashboard ไม่ให้เปลี่ยนไปลงทะเบียนบัญชี/URL ใหม่เงียบ ๆ ระหว่างค้างยกเลิก ตรวจ success เป็น HTTP 200 พร้อม Boolean `logged_out:true` จริง ไม่ใช้ truthy string

## 6. Key ที่ใช้ได้ — `GET /v1/client/keys`

ไม่มี body ใช้ full client Bearer HTTP 200:

```json
{"items":[{"key_id":"primary","name":"การแจ้งเตือนหลัก"}]}
```

`items` เป็น array; `key_id` ใช้ใน register ส่วน `name` ใช้แสดงผล ไม่มี secret ของ application key หากไม่มีรายการห้ามเดาหรือกรอก key ID ของบัญชีอื่นแทน; 401/403 ตามข้อ 3

## 7. ลงทะเบียน / อัปเดตเครื่อง — `POST /v1/client/devices/register`

ใช้ full client Bearer เมื่อล็อกอินแล้วมี FCM token หรือ token เปลี่ยน ใช้ session ที่ผูก installation นี้เท่านั้น

```json
{"key_id":"primary","device_name":"เครื่องจำลองหนึ่ง","fcm_token":"SYNTHETIC_FCM_TOKEN_NOT_FOR_PROVIDER"}
```

| Request key | ชนิด / ข้อกำหนด |
|---|---|
| `key_id` | string จาก `/v1/client/keys`; server ตรวจสิทธิ์ ไม่ใช่ master key |
| `device_name` | string 1–80 Unicode codepoints ไม่ว่างล้วน/ไม่มี control characters ชื่อแสดงผล ไม่ใช้ยืนยันบุคคล |
| `fcm_token` | opaque printable ASCII string 20–4096 ตัว (รหัส 33–126 ไม่มี whitespace); ข้อมูลอ่อนไหว ห้าม log/copy เข้า URL |

ไม่ส่ง `installation_id` หรือ `device_id` ใน body เพื่ออ้างว่าเป็นเครื่องอื่น HTTP 200:

```json
{"device_id":"22222222-2222-4222-8222-222222222222","installation_id":"11111111-1111-4111-8111-111111111111","key_id":"primary","device_name":"เครื่องจำลองหนึ่ง","registered":true,"updated_at":"2026-11-08T10:00:00Z"}
```

`device_id` เป็นทะเบียนของ server, `installation_id` ต้องเป็นของ login นี้, `registered:true` แปลว่ารับทะเบียนแล้ว **ไม่ใช่ยืนยันการส่งถึง** และ `updated_at` ไม่ใช่ last-online proof

การเรียกซ้ำของ installation เดิมต้องอัปเดตเครื่องเดิม ไม่เพิ่มปลายทางซ้ำ เปลี่ยน FCM token ให้ส่งค่าล่าสุด หลัง refresh token อย่าให้ผลคำขอเก่าทับข้อมูลใหม่ หาก logout/เปลี่ยนบัญชีหรือ URL ระหว่างรอ response ต้องทิ้งผลของ credential generation เดิม

| HTTP/code เฉพาะ registration | การรับมือ |
|---|---|
| 422 `invalid_key_id` | ใช้รายการจาก `/v1/client/keys` ไม่ส่ง secret/เดา key อื่น |
| 422 `invalid_device_name` | ชื่อไม่ว่าง 1–80 Unicode codepoints |
| 422 `invalid_fcm_token` | ขอค่าล่าสุดจาก Firebase ไม่แก้ token ด้วยมือ |
| 409 `fcm_token_conflict` | token ซ้ำกับอีกทะเบียน ไม่สร้างเครื่องใหม่ซ้ำวน ตรวจ/ยกเลิกทะเบียนเก่าที่มีสิทธิ์ก่อน |
| 409 `device_limit_reached` | เต็มขีดจำกัด 20 active devices ให้จัดการทะเบียนเดิมก่อน |
| 503 `ack_not_configured` | ระบบรับทราบระยะไกลยังไม่พร้อม ไม่ถือว่าลงทะเบียนสำเร็จ |
| 503 `device_registration_not_configured` | ระบบลงทะเบียนยังไม่พร้อม ติดต่อผู้ดูแล ไม่ขอ master key ใส่แอป |
| 503 `targeted_sender_not_configured` | ระบบกระจายส่งยังไม่พร้อม ใช้ backoff/แสดงไม่พร้อม |
| 503 `legacy_target_unavailable` | ยังย้ายปลายทางเดิมอย่างปลอดภัยไม่ได้ ห้ามถือว่าตัดเครื่องเดิมออกสำเร็จ |

ตัวอย่าง HTTP 409:

```json
{"error":{"code":"fcm_token_conflict"},"request_id":"synthetic-request-id"}
```

ตัวอย่าง HTTP 503:

```json
{"error":{"code":"device_registration_not_configured"},"request_id":"synthetic-request-id"}
```

เมื่อเปิดระบบทะเบียนครั้งแรก ปลายทางเดิมยังต้องอยู่ในกลุ่ม ถ้า login เครื่องใหม่ก่อนเครื่องเดิมจะไม่ตัดเครื่องเดิมออก หาก token ที่ลงทะเบียนตรงเครื่องเดิมให้ผูกทะเบียนนั้น ไม่เพิ่มผู้รับซ้ำ หลังยกเลิกหมดทุกเครื่องจะไม่กลับไปส่งหาเครื่องที่ยกเลิกแล้วอัตโนมัติ

## 8. รายชื่อเครื่อง — `GET /v1/client/devices` / `GET /api/devices`

ทั้งสองไม่มี body ไม่มี query; Android ใช้ full client Bearer ส่วน browser ใช้ full Dashboard cookie ตัวอย่าง HTTP 200:

```json
{"items":[{"device_id":"22222222-2222-4222-8222-222222222222","installation_id":"11111111-1111-4111-8111-111111111111","device_name":"เครื่องจำลองหนึ่ง","key_ids":["primary"],"active":true,"created_at":"2026-11-08T09:00:00Z","updated_at":"2026-11-08T10:00:00Z"}]}
```

| Response key | ความหมาย / UI |
|---|---|
| `items` | ทะเบียนในบัญชี; empty เป็น `[]` ไม่ใช่ error ไม่คืน FCM token |
| `items[].device_id` | UUID ที่ใช้กับการยกเลิกทะเบียน |
| `items[].installation_id` | UUID การติดตั้ง ไม่ใช่ hardware ID |
| `items[].device_name` | ชื่อแสดงผล อาจซ้ำกันได้ ให้ใช้ device ID เป็น row key |
| `items[].key_ids` | public key IDs ที่ผูก ห้ามนำไปใช้เป็น Bearer key |
| `items[].active` | ลงทะเบียนรับรายการใหม่หรือไม่ ไม่ใช่สถานะออนไลน์/กำลังเล่นเสียง |
| `items[].created_at`, `updated_at` | UTC timestamps ของทะเบียน ไม่ใช่เวลายืนยันส่งถึง |

จอไม่มีข้อมูลให้แนะนำเปิด APK แล้ว login/ลงทะเบียน อย่าร้องขอให้ผู้ใช้คัดลอก application key ลงแอป หากโหลดล้มเหลวคงข้อมูลเดิมได้แต่ต้องบอกว่าอาจไม่ล่าสุด ไม่มี pagination/count/sort query เพิ่มในรุ่นนี้

## 9. ยกเลิกเครื่อง — `DELETE /api/devices/{device_id}`

browser full session + mutation headers ข้อ 3 ไม่มี body และไม่มี query UUID ต้องมาจากรายการที่อ่านได้ ยืนยันก่อนส่ง ไม่เปลี่ยนทะเบียนใน UI ว่าสำเร็จก่อน server ยืนยัน

```text
DELETE /api/devices/22222222-2222-4222-8222-222222222222
Content-Type: application/json
X-Notify-Request: dashboard
```

HTTP 200:

```json
{"revoked":true}
```

`revoked:true` หมายถึงปิดรับรายการใหม่/ยกเลิก client session ของเครื่อง ไม่ได้ลบประวัติหรือหยุดเสียงที่เริ่มแล้ว การส่งที่เริ่มกระจายก่อนยกเลิกอาจไปถึงได้ ยังคงให้ local Ack ใช้งานได้เอง

401/403 ตามข้อ 3; 404 อุปกรณ์ไม่พบให้ refresh; timeout/502/503 ให้แสดงไม่แน่ใจผลและ refresh ก่อนลองซ้ำ เส้นทาง BFF ไป `/v1/dashboard/devices/{device_id}` ไม่ให้ browser กำหนด URL ปลายทางเอง

## 10. ผลส่งและ Ack รายเครื่อง

### คำขอส่งเดิมยังใช้ได้

`POST /v1/alerts` สำหรับระบบส่งและ `POST /api/test-alerts` สำหรับ browser ยังคงใช้ alert ID/title/message/TTL/importance และ idempotency ตาม [integration guide](service-integration-th.md) ห้ามเพิ่ม FCM token/target/device IDs ใน body

- HTTP 202 `provider_accepted`: ผู้ให้บริการรับครบทุกปลายทางของคำขอนั้น **ยังไม่ใช่ device delivery/audio proof**
- HTTP 502 `provider_failed`: ทุกปลายทางไม่สำเร็จแบบยืนยันผลปฏิเสธได้
- HTTP 502 `delivery_unknown`: มีผลกำกวมหรือผลรายเครื่องแตกต่างกัน ให้ดูรายละเอียด ไม่สรุปว่าทุกเครื่องไม่ได้รับ
- 503 `no_devices_registered`: ไม่มีปลายทางที่ใช้งานได้ ให้ลงทะเบียนเครื่อง ไม่วนสร้าง alert ID ใหม่
- timeout/409 `delivery_unknown_or_in_progress`/502 ให้ตรวจสถานะ ใช้ `Idempotency-Key` และ body เดิมสำหรับ retry คำขอเดิม การ retry ไม่กระจายซ้ำและไม่เพิ่มผู้รับจากทะเบียนที่เพิ่งเปลี่ยน
- TTL เป็นเส้นตายเริ่มแจ้งเตือน ไม่ใช่เวลาหยุดเสียง importance `normal` ไม่ทำให้ critical ที่กำลังดังเงียบ

ตัวอย่าง response รับคำขอครบ HTTP 202 (field เดิม):

```json
{"alert_id":"synthetic-shared-alert","status":"provider_accepted","expires_at":"2026-11-08T10:05:00Z","acknowledged":false,"delivery_verified":false,"importance":"critical"}
```

### `GET /api/alerts/{alert_id}` / `GET /v1/alerts/{alert_id}`

request ไม่มี body/เพิ่ม query สิทธิ์ตาม inventory; field เดิมยังอยู่ เพิ่ม `deliveries` และ device identity ของ `ack_actions` ตัวอย่าง HTTP 200 ของ browser BFF:

```json
{
  "alert_id":"synthetic-shared-alert",
  "title":"เหตุการณ์จำลอง",
  "message":"ข้อมูลสังเคราะห์ ไม่ใช่การทดสอบมือถือจริง",
  "importance":"critical",
  "status":"provider_accepted",
  "created_at":"2026-11-08T10:00:00Z",
  "provider_accepted_at":"2026-11-08T10:00:02Z",
  "expires_at":"2026-11-08T10:05:00Z",
  "acknowledged_at":"2026-11-08T10:01:00Z",
  "ack_count":1,
  "last_ack_at":"2026-11-08T10:01:00Z",
  "deliveries":[
    {"device_id":"22222222-2222-4222-8222-222222222222","device_name":"เครื่องจำลองหนึ่ง","status":"provider_accepted","provider_accepted_at":"2026-11-08T10:00:01Z","acknowledged_at":"2026-11-08T10:01:00Z","ack_count":1,"last_ack_at":"2026-11-08T10:01:00Z"},
    {"device_id":"44444444-4444-4444-8444-444444444444","device_name":"เครื่องจำลองสอง","status":"provider_accepted","provider_accepted_at":"2026-11-08T10:00:02Z","acknowledged_at":null,"ack_count":0,"last_ack_at":null}
  ],
  "ack_actions":[{"client_action_id":"33333333-3333-4333-8333-333333333333","device_id":"22222222-2222-4222-8222-222222222222","device_name":"เครื่องจำลองหนึ่ง","client_acked_at":"2026-11-08T10:00:59Z","received_at":"2026-11-08T10:01:00Z"}]
}
```

Direct Go API และคู่ `/v1/dashboard/alerts/{id}` เพิ่ม `acknowledged:true` และ `delivery_verified:false` ในตัวอย่างเดียวกัน BFF ไม่ส่งต่อสอง field นี้ ใช้ `acknowledged_at`/`ack_count` เพื่อแสดงสถานะตาม contract เดิม เส้นทางรายละเอียดอาจตอบ 404 `not_found` หรือ 503 `database_unavailable`; BFF จะแปลง envelope ตามข้อ 3 ไม่รับ arbitrary upstream fields/credential เพิ่ม

| Field | ความหมาย |
|---|---|
| `deliveries` | ผลแยกตามเครื่องที่เลือกตอนสร้างเหตุการณ์ ไม่ใช่รายชื่อเครื่องปัจจุบัน; response เก่าอาจไม่มี field นี้ |
| `deliveries[].device_id`, `device_name` | ตัวระบุและชื่อของเครื่องในประวัติเหตุการณ์ |
| `deliveries[].status` | ผลผู้ให้บริการของเครื่องนั้น ไม่ใช้แทนสถานะเล่นเสียง |
| `deliveries[].provider_accepted_at` | เวลา server ยืนยัน provider acceptance; null ไม่ใช่เวลาศูนย์ |
| `deliveries[].acknowledged_at` | server รับ Ack ครั้งแรกของเครื่องนี้; null หมายถึงยังไม่มีรายงาน |
| `deliveries[].ack_count`, `last_ack_at` | จำนวน action ไม่ซ้ำและเวลา server รับล่าสุดของเครื่องนี้ |
| `ack_actions[].device_id`, `device_name` | แหล่งที่มาของรายงาน; รายการ legacy อาจ null/ไม่ระบุ ห้ามเดาจากชื่อหรือเรียกว่าอีกคนกด |

Top-level `acknowledged` / `acknowledged_at` และ filter `acknowledged` หมายถึง **มีอย่างน้อยหนึ่งเครื่อง** ไม่ใช่ครบทุกเครื่อง; provider outcome ไม่เปลี่ยนเป็น success เพียงเพราะมี Ack

Timeline dedup ด้วย `(device_id, client_action_id)`; legacy ใช้กลุ่มไม่ระบุเครื่อง อย่าลบ action ของอีกเครื่องเพียงเพราะ UUID ตรงกัน `received_at` เป็นเวลาหลัก ส่วน `client_acked_at` อาจคลาดเคลื่อน `ack_action_count` ของสถิติ dedup ข้ามเหตุการณ์แยกต่อเครื่อง จึงไม่เพิ่มจำนวนเพราะ retry หรือ Ack-all รายการเดิม

### `POST /v1/alerts/{alert_id}/ack`

ใช้ `ack_url` / `ack_token` ของ alert ที่มือถือเครื่องนี้ได้รับ ไม่ใช้ application key หรือ client-login token แทน body ยังคงเดิม:

```json
{"client_action_id":"33333333-3333-4333-8333-333333333333","client_acked_at":"2026-11-08T10:01:00Z"}
```

`client_action_id` UUID หนึ่งค่าต่อการกดของคนจริง ใช้ค่าเดิมทุกครั้งที่ retry รวมถึงหลังเปิดแอปใหม่ และใช้ร่วมกันกับทุก alert ใน Ack-all ครั้งนั้นได้ แต่ server จะแยกตามเครื่อง ไม่ส่ง `device_id` เพื่ออ้าง Ack เครื่องอื่น capability อีกเครื่องไม่ให้สิทธิ์แก้การรับทราบของเครื่องนี้

หยุดเสียงและเก็บ pending Ack ในเครื่องได้แม้ offline แล้ว sync ภายหลัง อย่าลบ pending Ack เมื่อ session login หมดอายุ/FCM token เปลี่ยน/logout และอย่าหยุดเสียงเครื่องอื่นเพราะ response นี้ HTTP/envelope เดิมดู [Ack sync](ack-sync-th.md); 401 ของ capability ไม่ใช่การขอ application key จากผู้ใช้

HTTP 200 เมื่อรับรายงาน (เป็นยอดของเหตุการณ์ ไม่ใช่คำสั่งหยุดทุกเครื่อง):

```json
{"alert_id":"synthetic-shared-alert","status":"acknowledged","acknowledged_at":"2026-11-08T10:01:00Z","ack_count":1,"last_ack_at":"2026-11-08T10:01:00Z"}
```

422 `invalid_client_action_id` / `invalid_client_acked_at` ต้องแก้ข้อมูล; 401 `unauthorized` ไม่ retry เป็น loop; 503 `ack_state_unavailable` เก็บ pending และ retry action เดิมตาม backoff ไม่มีการนับเป็นการกดใหม่

## 11. FE adoption checklist

- [ ] Android login ด้วยบัญชีเดิม สร้าง installation UUID แยกต่อเครื่อง เก็บ session แบบเข้ารหัส ไม่เก็บ password
- [ ] รับ forced password change / token rotation / session expiry โดยไม่ส่ง API key ลง APK
- [ ] ลงทะเบียนทันทีเมื่อมี session+FCM token และอัปเดตเมื่อ token เปลี่ยน ไม่ให้ callback เก่าทับ account generation ใหม่
- [ ] ใช้งาน retry/backoff แบบ network-constrained; ไม่มี session ไม่วนขอ login เอง
- [ ] Logout offline แสดงรอยืนยัน server; ไม่ให้ heartbeat ลงทะเบียนกลับระหว่างยกเลิก
- [ ] Browser device list ไม่แสดง FCM token ไม่เรียกสถานะทะเบียนว่า online และยืนยันก่อน revoke
- [ ] Detail อ่าน response เก่าที่ไม่มี deliveries ได้ แสดงครบรายเครื่องเมื่อมี ไม่สรุป Ack ทุกเครื่องจาก top-level field
- [ ] Timeline ใช้ device+action identity และคงความหมาย null/unknown ไม่แทนด้วยศูนย์
- [ ] คำขอ send retry ใช้ key/body เดิม ไม่ให้ทะเบียนที่เปลี่ยนทำให้กระจายเหตุการณ์เดิมซ้ำ
- [ ] Critical เล่นต่อจนกดรับทราบบนเครื่องนั้น normal ไม่หยุด critical ที่กำลังดัง
- [ ] ทดสอบด้วย sender จำลองและข้อมูลสังเคราะห์ก่อน การรับทะเบียนหรือ provider acceptance ไม่ใช่ผลทดสอบเสียงจริง

## ขอบเขตความพร้อม

สัญญานี้ไม่เพิ่ม email login/public signup/การสร้างหลาย application keys และไม่ยืนยันการรับ push/เสียง/การย้ายข้อมูลบนเครื่องจริง ขั้นตอนตั้งค่าระบบสำหรับผู้ดูแลแยกอยู่ใน runtime guide ไม่ใช่หน้าที่ FE ในการเข้าถึง secrets
