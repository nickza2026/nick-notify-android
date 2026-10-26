# ระบบแจ้งเตือน Android ผ่าน API — ผลสำรวจและข้อเสนอสถาปัตยกรรม

วันที่สำรวจ: 19 ตุลาคม 2026  
สถานะ: เอกสารสถาปัตยกรรมเป้าหมาย; เริ่มทำ Android native PoC แล้ว ดูสถานะ implementation และผลทดสอบจริงใน [คู่มือ PoC](android-poc-th.md) ไม่ถือว่า API ทั้งหมดด้านล่างมีใช้งานแล้ว  
เป้าหมาย: แอป Android ของเราเอง ติดตั้งด้วย APK รับเหตุการณ์จาก server และแจ้งเตือนคล้ายนาฬิกาปลุก พร้อมเตรียมต่อยอด iOS

> เอกสารนี้แยกข้อเท็จจริงที่ตรวจจากเอกสารผู้ให้บริการ ออกจาก API/พฤติกรรมที่เสนอสำหรับระบบใหม่ หัวข้อ 5–7 เป็น full-system contract ที่ยังไม่ได้ implement ครบ ส่วน API bridge PoC มีเพียง subset และ schema/response ต่างกัน ให้ใช้ [server README](../server/README.md) เป็นสัญญาของโค้ดปัจจุบัน ห้ามใช้ตัวอย่าง full-system API ด้านล่างเรียก bridge โดยถือว่าเข้ากันได้

> **ข้อกำหนดเพิ่มเติมจากผู้ใช้หลังการสำรวจ:** ใช้เองบน Pixel 6 Pro และยอมให้สิทธิ์ที่จำเป็น ต้องเล่นเสียงวนจนกดรับทราบ ไม่หยุดเพราะตู้กลับมา ON เอง และไม่หยุดตาม TTL เมื่อเริ่มเสียงแล้ว ดังนั้นข้อเสนอเดิมเรื่อง expiry/local maximum duration ในเอกสารนี้ยังไม่ใช่พฤติกรรม PoC: รุ่นปัจจุบันใช้ expiry เป็น **เส้นตายเริ่มปลุก** เท่านั้น ต้องแยก delivery expiry ออกจาก ring lifetime ใน full API ก่อน implementation จริง การหยุดโดย OS/ผู้ใช้ผ่านระบบยังอาจเกิดได้

## 1. ข้อสรุปและขอบเขต

แนะนำ **Flutter สำหรับ UI + Kotlin สำหรับ Android alert engine + Firebase Cloud Messaging (FCM) สำหรับรับเหตุการณ์** ส่วน Backend หากไม่มีระบบเดิม ใช้ NestJS + PostgreSQL + Redis/BullMQ ได้ แต่ยังไม่ใช่ข้อผูกมัดว่าจะต้องใช้ stack นี้

เหตุผลคือแชร์หน้าจอไป iOS ได้ ขณะที่ส่วนรับ push เล่นเสียงเบื้องหลัง จัดการสิทธิ์ และหน้าจอปลุกต้องควบคุมด้วย native code ไม่พึ่ง notification plugin อย่างเดียว

ความสามารถเป้าหมาย:

- Server ส่งข้อความเข้าผู้ใช้/อุปกรณ์ที่ได้รับอนุญาตผ่าน HTTPS API
- รองรับแจ้งเตือนปกติ และโหมด alarm ที่เล่นเสียงวนในเครื่องตามสิทธิ์และข้อจำกัด OS
- มีรับทราบ (Ack), เลื่อนเตือน (Snooze), วันหมดอายุ และประวัติ
- Server แจ้งซ้ำเมื่อไม่มี Ack และเพิ่มช่องทาง/ผู้รับตาม escalation policy ในระยะถัดไป
- แสดงสถานะสิทธิ์และข้อจำกัดที่อาจทำให้การเตือนไม่ทำงาน

ไม่รับประกันการส่งทันทีหรือการได้ยินเสียงทุกสถานะ ไม่ใช่ช่องทางเดียวสำหรับงานความปลอดภัยสูง ไม่รวมการทำระบบทดแทน FCM/APNs และไม่รับรองการอนุมัติ Google Play/Apple entitlement

## 2. เครื่องมือและทางเลือก

| ทางเลือก | ความเหมาะสม | ข้อจำกัด |
|---|---|---|
| Flutter + Kotlin native | แนะนำสำหรับแอปของเรา แชร์ UI Android/iOS และ build APK | Android alert engine และ iOS integration ยังต้องทำแยก |
| React Native + Firebase + Notifee | เหมาะถ้าทีมถนัด React/TypeScript | library ไม่ทำให้ข้ามข้อจำกัด background/permissions |
| Kotlin + Jetpack Compose | ควบคุม Android โดยตรง เหมาะเมื่อ Android สำคัญที่สุด | การไป iOS ต้องทำเพิ่ม; Kotlin Multiplatform ช่วยแชร์ logic แต่ไม่ลบข้อจำกัด OS |
| ntfy | มี HTTP publishing, Android/iOS app และ self-hosting เหมาะทดลอง workflow เร็ว | ไม่ควรถือว่าเทียบเท่าเสียงวนพร้อม Ack; self-hosted iOS instant delivery มี upstream push dependency |
| Pushover | ใช้ API และแอปเดิมได้ทันที มี emergency retry/receipt/Ack | ไม่ใช่ APK ของเราเอง และขึ้นกับบริการภายนอก |
| Gotify | เป็นทางเลือก self-hosted ที่ควรศึกษาเพิ่มเติม | รอบนี้หลักฐานที่อ่านไม่พอยืนยัน iOS/Ack/retry จึงไม่เสนอว่าเทียบเท่า Pushover |

ตารางนี้เป็นการประเมินความเหมาะสม ไม่ใช่อันดับความนิยม และยังไม่ได้ benchmark library บนอุปกรณ์จริง

เครื่องมือ build ที่คาดว่าจะใช้: Flutter SDK, Android SDK, JDK/Gradle ตาม compatibility ของ Flutter รุ่นที่เลือก และ Android Studio หรือ CLI ส่วน iOS ต้องมี macOS/Xcode และ signing ที่เหมาะสม การแจกตรงใช้ signed APK; การขึ้น Play ใช้ AAB ตามข้อกำหนดสโตร์ ต้องเก็บ signing key เป็น secret และใช้ key เดิมสำหรับอัปเดตแอป

## 3. พฤติกรรม Pushover ที่ตรวจสอบแล้ว

อ้างอิง [Pushover API](https://pushover.net/api):

- Emergency ใช้ `priority=2` ต้องส่ง `retry` และ `expire`
- `retry` อย่างน้อย 30 วินาที; `expire` สูงสุด 10,800 วินาที (3 ชั่วโมง)
- จำกัด 50 retries ดังนั้นตั้งทุก 30 วินาทีไม่ได้แปลว่าจะแจ้งซ้ำต่อเนื่องครบ 3 ชั่วโมง
- ได้ `receipt` สำหรับตรวจ Ack และใช้ callback เมื่อมีการรับทราบ
- ส่งเข้ากลุ่ม: คนแรกที่รับทราบจะยกเลิก retry ของคนอื่นในกลุ่ม
- เป็น **แจ้งเตือนซ้ำจาก server** ไม่ใช่หลักฐานว่าเล่นเสียงยาวต่อเนื่องในเครื่อง
- API สำเร็จไม่ใช่หลักฐานว่ามือถือได้รับ ผู้ใช้ได้ยิน หรือผู้ใช้รับทราบ

ระบบใหม่ควรนำแนวคิด receipt/Ack/retry มาใช้ แต่กำหนด semantics ของตัวเองให้ชัด ไม่อ้างว่า compatible กับ Pushover API โดยอัตโนมัติ

## 4. สถาปัตยกรรมและข้อจำกัดแพลตฟอร์ม

```text
ระบบต้นทาง → HTTPS Alert API → PostgreSQL + transactional outbox
                                  ↓
                           Queue/Retry Worker
                                  ↓
                      FCM → Android native receiver
                                  ↓
                      persist / dedupe / expiration check
                                  ↓
                   notification + alarm service (ถ้าระบบอนุญาต)
                                  ↓
                       device events / Ack → Backend

อนาคต: Backend → APNs (โดยตรงหรือผ่าน FCM) → iOS native integration
```

### 4.1 Android

1. ใช้ high-priority **data message** เมื่อจำเป็นต้องให้ native receiver ประมวลผล ขณะ background ข้อความแบบ notification เข้า system tray; แบบ notification+data ไม่ควรคาดว่า receiver จะเริ่มเสียงเองทันที
2. FCM high priority พยายามส่งทันทีและปลุกเครื่องจาก sleep เพื่อประมวลผลช่วงสั้น ไม่รับประกันเวลา; normal priority อาจรอออกจาก Doze
3. ต้องแสดง notification ที่ผู้ใช้เห็นจริง ไม่ใช้ high priority เป็นช่องทางทำ background job ทั่วไป มิฉะนั้นอาจถูก downgrade; Firebase ประเมินพฤติกรรมย้อนหลัง 7 วันต่อ app instance
4. ใส่ข้อมูลจำเป็นใน payload เพื่อแสดงได้ทันที ไม่บังคับให้เรียก backend ก่อนแสดง บันทึกเหตุการณ์และส่ง telemetry แบบทนต่อ network failure
5. เสียงวนต้องมี native service ที่ประกาศประเภท/permission ตรงงาน Android 12+ จำกัดเริ่ม foreground service จาก background; FCM ที่ได้รับจริงเป็น high priority เป็นข้อยกเว้นหนึ่ง ต้องตรวจ priority และมี fallback หากเริ่มไม่ได้ ไม่ถือว่าเลือก `mediaPlayback` แล้วจะผ่าน policy อัตโนมัติ
6. Android 13+ ต้องขอ `POST_NOTIFICATIONS` สำหรับ notification ทั่วไป ไม่ใช้ foreground service เป็นทางเลี่ยงการปฏิเสธสิทธิ์
7. Android 14+ มีการควบคุม full-screen intent ต้องตรวจ `canUseFullScreenIntent()` และให้ผู้ใช้จัดการสิทธิ์; auto-grant บน Play จำกัดตาม core functionality และ policy ต้อง fallback เป็น notification เมื่อไม่มีสิทธิ์ ไม่สรุปว่า remote monitoring เป็น alarm app ที่ผ่านเกณฑ์แน่นอน
8. Notification importance สูงไม่เท่ากับข้าม Do Not Disturb การใช้ DND policy access ต้องให้ผู้ใช้อนุญาตและทดสอบ ไม่ปรับระดับเสียงหรือ DND โดยไม่แจ้งผู้ใช้
9. Exact alarm ใช้จัดเวลาบนเครื่อง เช่น Snooze หลังได้รับเหตุการณ์ ไม่ช่วยให้ remote push มาถึงตรงเวลา ขอสิทธิ์เฉพาะเมื่อใช้จริงและเข้าเกณฑ์
10. Force-stop จาก Settings ต่างจากปัดแอปออก ต้องเปิดแอปใหม่เพื่อกลับมารับข้อความตามเงื่อนไข FCM; ไม่มีเน็ต เครื่องดับ และ OEM battery restrictions เป็นความเสี่ยงที่ต้องทดสอบ การติดตั้ง APK เองไม่ข้ามข้อจำกัด OS
11. แอปที่ target Android 15/API 35 ขึ้นไปไม่สามารถเริ่ม mediaPlayback foreground service จาก `BOOT_COMPLETED` จึงไม่วางแผนให้บูตแล้วเปิดเสียงเองผ่านเส้นทางนี้

### 4.2 iOS ในอนาคต

- ใช้ APNs เป็นปลายทาง push; Flutter ช่วยแชร์ UI ไม่แชร์ข้อยกเว้นของ OS
- Critical Alerts ข้าม mute/Do Not Disturb ได้เมื่อมี entitlement ที่ Apple อนุมัติและสิทธิ์ผู้ใช้ ยังไม่ทราบว่าโครงการนี้จะได้รับอนุมัติหรือไม่
- AlarmKit (iOS/iPadOS 26+) รองรับ alarm/timer, schedule, snooze และ authorization แต่เอกสารที่ตรวจไม่ยืนยันวิธีให้ backend สั่ง arbitrary alarm ผ่าน APNs โดยตรง
- Silent/background push ไม่รับประกัน delivery อาจถูกหน่วงหรือ throttle จึงไม่ใช้เป็นหลักประกันเส้นทาง push → ปลุกแอป → สร้าง AlarmKit alarm ทันที
- UI/API ต้องแสดงความสามารถจริงของแต่ละ device เช่น `supports_continuous_alarm` และสถานะสิทธิ์ ไม่รับปาก iOS เท่ากับ Android ก่อนพิสูจน์

## 5. สัญญา API ที่เสนอ

### 5.1 สิทธิ์และความปลอดภัย

- ระบบต้นทางใช้ `Authorization: Bearer <application_api_key>` ผ่าน HTTPS เท่านั้น; API key อยู่ฝั่ง server ห้ามฝังไว้ใน APK
- Key จำกัด tenant/application, recipient allowlist และ scopes เช่น `alerts:send`, `alerts:read`, `alerts:cancel` ปิด/หมุน key ได้
- แอปใช้ user/device access token แยกจาก application key; ลงทะเบียนเครื่อง อ่านเฉพาะ alert ของตน ส่ง device events และ Ack ได้ตามสิทธิ์
- Tenant/user มาจาก token และ ownership validation ไม่เชื่อ `user_id` ใน request โดยลำพัง Device push token ถือเป็นข้อมูลอ่อนไหว ไม่บันทึกเต็มลง log
- Push เป็นสัญญาณที่ต้อง validate schema/อายุ/เป้าหมาย ไม่ใช่สิทธิ์เข้าถึงข้อมูล; payload ลดข้อมูลลับบน lock screen และรองรับซ่อนข้อความ
- Callback URL ต้องป้องกัน SSRF: HTTPS, ตรวจปลายทาง/redirect/DNS ตามนโยบาย ห้าม private/loopback/link-local และ metadata endpoints; ส่งลายเซ็น HMAC+timestamp และ receiver dedupe/replay check

### 5.2 Endpoint และ authorization

| Endpoint ที่เสนอ | ผู้เรียก/สิทธิ์ | หน้าที่ |
|---|---|---|
| `POST /v1/devices` | authenticated app user | ลงทะเบียน installation และ push token ของตน |
| `PATCH /v1/devices/{device_id}` | owner device/user | เปลี่ยน token, capabilities, permission snapshot |
| `DELETE /v1/devices/{device_id}` | owner device/user | ยกเลิกการลงทะเบียนและหยุดส่งหาเครื่อง |
| `POST /v1/alerts` | application key, `alerts:send` | สร้าง alert และ enqueue |
| `GET /v1/alerts/{alert_id}` | scoped application key หรือ recipient user | ดูสถานะที่ได้รับอนุญาตและ receipt |
| `GET /v1/alerts?cursor=...&limit=...` | recipient user | sync ประวัติ/เหตุการณ์ที่ยัง active แบบ cursor pagination |
| `POST /v1/alerts/{alert_id}/events` | target device token | รายงาน received/alarm_started/alarm_failed/stopped |
| `POST /v1/alerts/{alert_id}/ack` | recipient user/device | ยืนยันรับทราบอย่างชัดเจน |
| `POST /v1/alerts/{alert_id}/snooze` | recipient user/device | เลื่อนเสียงเฉพาะเครื่อง ไม่ใช่ Ack |
| `POST /v1/alerts/{alert_id}/cancel` | scoped key, `alerts:cancel` | ยกเลิก retry และส่งคำสั่งหยุดแบบ best effort |

### 5.3 ตัวอย่างสร้าง alert

```http
POST /v1/alerts
Authorization: Bearer <server-side-api-key>
Idempotency-Key: incident-pump-42-start-001
Content-Type: application/json
```

```json
{
  "target": { "user_ids": ["usr_123"], "device_ids": [] },
  "title": "ปั๊มหยุดทำงาน",
  "message": "ตรวจสอบอุปกรณ์หมายเลข 42",
  "mode": "alarm",
  "sound": "alarm_default",
  "retry_seconds": 60,
  "ttl_seconds": 1800,
  "max_retries": 20,
  "ack_policy": "any_recipient",
  "metadata": { "incident_id": "pump-42" }
}
```

| Key | ข้อกำหนดที่เสนอ |
|---|---|
| `target` | ต้องมี `user_ids` หรือ `device_ids` อย่างใดอย่างหนึ่งแบบไม่ว่าง ห้ามใส่ทั้งสองแบบไม่ว่าง; server resolve เฉพาะเป้าหมายใน scope และ snapshot target devices ตอนสร้าง |
| `title`, `message` | required string; เสนอสูงสุด 120 และ 2,000 ตัวอักษรตามลำดับ ต้องตรวจขนาด payload UTF-8 รวม ไม่ใช่จำนวนอักษรอย่างเดียว |
| `mode` | `notification` หรือ `alarm`; ไม่ใช่การรับรองว่า OS จะอนุญาตเสียงวน |
| `sound` | ID จาก allowlist ในแอป ห้ามเป็น arbitrary file path/URL |
| `retry_seconds` | สำหรับ alarm: default 60, ขั้นต่ำเสนอ 30 วินาที; เป็น server retry ไม่ใช่ช่วงเสียงวน |
| `ttl_seconds` | default 1,800, เสนอช่วง 30–10,800 วินาที นับจาก server accepted time |
| `max_retries` | default 20, เสนอ 0–50 ครั้ง **ไม่รวมการส่งครั้งแรก**; หยุดเมื่อหมดอายุแม้ยังไม่ครบจำนวน |
| `ack_policy` | PoC รองรับ `any_recipient` เท่านั้น: คนใดคนหนึ่งใน target รับทราบแล้วหยุด retry ทั้ง alert |
| `metadata` | optional bounded JSON ใช้เชื่อม incident; ไม่ใส่ secrets และไม่นำไปแสดงเป็น HTML โดยตรง |
| `Idempotency-Key` | required; ผูก tenant/application และ request hash; key เดิม+body เดิมคืน alert เดิม ไม่สร้าง retry เพิ่ม; key เดิม+body ต่างตอบ 409 |

ค่าจำกัดเป็นข้อเสนอของระบบเรา ไม่ใช่ข้อกำหนด FCM หรือการรับรองว่าเหมาะสมกับ production แล้ว เมื่อ `mode=notification` ให้ปฏิเสธ retry/alarm-only fields เพื่อไม่ให้ผู้เรียกเข้าใจผิด ต้องกำหนด final limits ก่อน implementation รวมถึง target count, metadata bytes, rate limits และอายุ idempotency record (อย่างน้อยครอบคลุม TTL และช่วง retry ของผู้เรียก)

FCM จำกัด payload สูงสุด 4,096 bytes ต้องตรวจ **message payload สุดท้ายหลัง serialize** รวม keys และข้อมูลระบบของเราที่อยู่ใน payload เป็น UTF-8 ไม่ใช่แยกตรวจความยาวข้อความอย่างเดียว โดยเฉพาะภาษาไทยซึ่งอาจใช้หลาย bytes ต่อตัวอักษร เพดาน 2,000 ตัวอักษรจึงไม่รับรองว่าข้อความนั้นจะผ่าน payload budget ให้ตรวจทุก target platform ก่อนตอบ 202 และปฏิเสธด้วย `422 payload_too_large` หากเกิน budget โดยเผื่อพื้นที่สำหรับ IDs/version/timestamps ที่ worker เพิ่มภายหลัง ห้ามตัดทอนข้อมูลสำคัญเงียบ ๆ หากจะรองรับข้อความยาวผ่าน summary/detail ต้องเพิ่ม field และระบุ contract แยกภายหลัง

ตัวอย่างตอบรับ:

```json
{
  "alert_id": "alt_001",
  "status": "accepted",
  "receipt_id": "rcpt_001",
  "accepted_at": "2026-10-19T04:50:00Z",
  "expires_at": "2026-10-19T05:20:00Z",
  "target_device_count": 1
}
```

HTTP `202 Accepted` หมายถึงบันทึกและรับเข้าคิวแล้ว ไม่ได้แปลว่า provider/เครื่องได้รับหรือเริ่มเสียง ต้องสร้าง alert+outbox ใน transaction เดียวกัน ป้องกันตอบสำเร็จแต่ไม่มีงานส่ง หาก resolve ไม่มี target ที่ใช้ได้ให้ตอบ `422 no_eligible_targets` ไม่ตอบ accepted เงียบ ๆ

### 5.4 Events, Ack, Snooze และ Cancel

- Device event body: `event_id`, `type`, `occurred_at`, optional `reason_code`; `device_id` อ้างจาก token ไม่เชื่อ body ใช้ `(device_id,event_id)` กันซ้ำ เวลาเครื่องเป็น telemetry ไม่ใช่เวลาตัดสิน expiry
- Ack body: `action_id`; server ผูก actor, alert, device และเวลา รับซ้ำแล้วคืนผลเดิม Ack ต้องมาจาก action ชัดเจน ไม่ใช่เปิด notification/ได้รับ push
- เมื่อ Ack commit ให้เขียน terminal-state outbox ใน transaction เดียวกัน ส่ง `acknowledged` พร้อม `state_version` ไปทุก target device แบบ best effort เครื่องที่รับต้องหยุดเสียงและยกเลิก Snooze timer; เครื่องที่ออฟไลน์อาจยังเตือนจน local expiry หรือกลับมา sync ไม่อ้างว่าหยุดทุกเครื่องได้ทันที
- Snooze body: `action_id`, `duration_seconds` (เสนอ 60–900 และห้ามเกินเวลาที่เหลือ) หยุดเสียงบนเครื่องทันทีและตั้งเวลาใหม่ตามสิทธิ์ local scheduling; ไม่เลื่อน expiry และไม่หยุดเตือนเครื่องอื่น
- Client ต้อง persist local `snoozed_until` ก่อนหยุดเสียง และตรวจค่านี้ก่อนเริ่มเสียงทุกเส้นทาง รวม in-flight retry, ข้อความซ้ำ และ process restart; terminal state ที่รู้แล้วมีลำดับเหนือ Snooze และต้องยกเลิก timer
- Snooze ที่ backend รับแล้วต้องกด server retry สำหรับเครื่องนั้นจนถึง `snoozed_until`; ไม่ขอ exact-alarm permission โดยไม่จำเป็น หากตั้ง local timer ไม่ได้ให้แสดงข้อจำกัด ไม่แจ้งว่ารับประกันปลุกตามเวลา
- Online Snooze response คืน authoritative `snoozed_until` สำหรับ offline action ให้ส่ง `requested_at` และ `requested_until` ที่บันทึกจากเจตนาเดิมควบคู่ `duration_seconds` และ `action_id` โดยใช้ server-time offset ล่าสุด Server ตรวจช่วงเวลา/clock-skew และ clamp ไม่ให้เกิน expiry หรือช่วงอนุญาต ห้ามเริ่มนับ duration ใหม่ตอน sync หากช่วงเดิมผ่านไปแล้วไม่สร้าง Snooze ใหม่ หากไม่สามารถยืนยันเวลาในเกณฑ์ได้ให้ตอบ `409 snooze_time_unverifiable` และ sync สถานะ ไม่แอบเริ่มช่วงใหม่ ต้องกำหนด clock-skew tolerance ก่อน implementation
- หากออฟไลน์ให้เก็บ pending Ack/Snooze และ sync เมื่อกลับออนไลน์; UI ต้องบอกว่ายังไม่ส่งถึง server เครื่องอื่นจึงอาจยังเตือนอยู่
- Cancel หยุดการสร้าง retry ใหม่ทันทีที่ commit แต่คำสั่งหยุดบนเครื่องเป็น best effort; client ต้องมี expiry timeout และตรวจ terminal state ตอน reconnect
- Ack/Cancel/Expiry แข่งกันให้ใช้ atomic transition และ server time เป็นหลัก หลัง terminal แล้วไม่ย้อนเป็น active; replay action ID ที่เคยสำเร็จคืนผลเดิม Ack ใหม่เมื่อ `acknowledged` อยู่แล้วตอบ `200` พร้อม canonical Ack เดิมโดยไม่เปลี่ยน actor/time ส่วน Ack ใหม่หลัง `expired/cancelled` และ Snooze ใหม่หลัง terminal ทุกชนิดตอบ `409 alert_not_active` หากช่วง offline Snooze ผ่านไปแล้วแต่ alert ยัง active ตอบ `409 snooze_window_elapsed` โดยไม่สร้างช่วงใหม่ Cancel ซ้ำเมื่อ cancelled แล้วคืนผลเดิม แต่ Cancel ใหม่หลัง acknowledged/expired ตอบ `409 alert_not_active`

### 5.5 Error contract

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Invalid request",
    "fields": { "ttl_seconds": "out_of_range" }
  },
  "request_id": "req_001"
}
```

| HTTP | กรณี |
|---|---|
| 400 | JSON/schema ไม่ถูกต้อง |
| 401 | token/key ไม่มีหรือใช้ไม่ได้ |
| 403 | authenticated แต่ scope ไม่พอ; target นอก scope ตอบแบบไม่เปิดเผยข้อมูลสมาชิก |
| 404 | resource ไม่มีหรือไม่เปิดเผยต่อ actor ตาม resource-access policy |
| 409 | idempotency body ขัดแย้ง, action ไม่อนุญาตต่อ lifecycle ปัจจุบัน หรือ offline Snooze time/window ใช้ไม่ได้ตามรหัสที่ระบุข้างต้น; Ack หลัง acknowledged คืน 200 ตาม contract |
| 422 | ค่า/target ใช้ไม่ได้ตาม business rules หรือ `payload_too_large` ก่อนรับเข้าคิว |
| 429 | เกิน rate limit พร้อม `Retry-After` |
| 503 | ยังรับงานเข้าระบบไม่ได้ ให้ retry ด้วย idempotency key เดิม |

Provider ส่งล้มเหลวหลังตอบ 202 ให้ปรากฏใน receipt ไม่เปลี่ยนย้อนหลังเป็น HTTP error ของคำขอเดิม Worker retry transient error ด้วย backoff/jitter ภายใน expiry และลบ/disable push token ที่ provider ยืนยันว่า invalid แยกจาก business retry ที่เตือนผู้ใช้ซ้ำ

## 6. Receipt และ semantics การส่ง

อย่าใช้สถานะเดียวแทนทุกความหมาย:

| ระดับ | สถานะ/เหตุการณ์ | แปลว่า |
|---|---|---|
| Alert lifecycle | `active`, `acknowledged`, `expired`, `cancelled` | สถานะงานโดยรวม; response แรก `accepted` คือการรับคำขอซึ่งสร้าง active alert |
| Per-attempt delivery | `queued`, `provider_accepted`, `provider_failed` | รู้เพียงผลการส่งให้ provider |
| Per-device telemetry | `device_received`, `alarm_started`, `alarm_failed`, `stopped` | เครื่องรายงานผล ไม่ใช่หลักฐานว่าผู้ใช้ได้ยิน |
| Explicit human action | `acknowledged` + actor/time | ผู้ใช้กดรับทราบตามสิทธิ์ |

Receipt endpoint ควรคืน lifecycle, expiry, resolved targets ที่ actor มีสิทธิ์เห็น, per-device last events, attempt count, next retry และ Ack actor/time พร้อม reasons ที่ไม่เปิดเผย secrets ไม่เรียก provider acceptance ว่า delivered

### เวลาและการกันข้อความซ้ำ

- เวลา authoritative เป็น UTC server time; UI แสดงตาม timezone ผู้ใช้
- FCM TTL ต้องไม่เกินเวลาที่เหลือของ alert และ client ตรวจ `expires_at` ก่อนเริ่มเสียง ไม่ปลุกเหตุการณ์เก่าหลัง reconnect
- ตั้ง timer หยุดเสียงเมื่อหมดอายุ มีเพดานเวลาปลุกในเครื่อง และจัดการ clock skew โดยอาศัย server-time offset ที่ sync ไว้ ไม่เชื่อเวลามือถือโดยไม่ตรวจ
- ใช้ `alert_id` คงที่และ `attempt_id` แยกครั้งส่ง เก็บ terminal/dedupe state แบบ durable ป้องกัน retry หรือข้อความผิดลำดับเปิดเสียงซ้ำหลัง Ack
- Business retry ไม่สร้าง alarm instance ซ้อน เสียงเดิมยังทำงานให้ update notification/state เท่านั้น
- ไม่ collapse คนละ incident เข้าด้วยกันโดยไม่ตั้งใจ; การหยุด/terminal event ต้องมี version เพื่อไม่ให้ active message เก่าชนะ terminal state
- Server หยุด retry ไม่ได้หมายความว่าเครื่องที่ออฟไลน์หยุดเสียงทันที ต้องใช้ local expiry เป็นขอบเขตและ sync state เมื่อกลับมา
- ก่อน push รอบใหม่ worker ตรวจ active/expiry/snooze อีกครั้ง แม้ตรวจแล้วอาจมี in-flight race จึงต้องให้ client ป้องกันด้วย

## 7. Callback และการเชื่อมระบบต้นทาง

ระยะถัดไปเสนอ callback `alert.acknowledged`, `alert.expired`, `alert.cancelled` แบบ at-least-once ส่ง `event_id`, `alert_id`, lifecycle, server timestamp และ signature โดยไม่เปิดเผยรายละเอียด device เกินความจำเป็น Receiver ต้อง dedupe และตอบ 2xx เมื่อรับอย่าง durable แล้ว

Callback อาจมาซ้ำ/ผิดลำดับ ระบบต้นทางควรตรวจ version หรืออ่าน receipt ล่าสุด ห้ามถือว่า callback ล้มเหลวแล้ว Ack ถูกยกเลิก Worker retry callback ด้วย backoff มี deadline และ dead-letter/audit แยกจาก alarm retry

## 8. หน้าจอแอปและ permission onboarding

1. เข้าสู่ระบบ/จับคู่เครื่อง และลงทะเบียน push token; รับมือ token rotation, logout และเปลี่ยนบัญชีโดยไม่รั่วข้ามผู้ใช้
2. หน้า readiness: notification permission, channel state, full-screen permission, DND policy ตามฟีเจอร์จริง, battery restrictions และ last successful test พร้อมเวลาอัปเดต snapshot
3. ปุ่มทดสอบ end-to-end แยกจากทดสอบเสียงในเครื่อง; ตั้งชื่อผลให้ตรงสิ่งที่ตรวจได้
4. หน้า active alarm: ชื่อ/ข้อความ/เวลา/ความรุนแรง รับทราบ เลื่อนเตือน และแสดง pending offline action
5. ประวัติและ receipt แสดง accepted/received/alarm_started/Ack แยกกัน รวมถึงเหตุผลที่ไม่สามารถปลุก
6. ตั้งค่าเสียง สั่น ความเป็นส่วนตัวบน lock screen และระยะเสียงสูงสุด ไม่ใช้คำว่า ready เมื่อยังไม่ได้ให้สิทธิ์จำเป็น

Permission snapshot อาจเก่า ต้องตรวจซ้ำเมื่อกลับเข้าแอปและก่อนใช้ capability ไม่ให้ server snapshot เป็นหลักประกันว่าสิทธิ์ยังเปิดอยู่

## 9. แผน PoC และเกณฑ์ยอมรับ

### ระยะ A — พิสูจน์ความเสี่ยงหลักก่อนทำแอปเต็ม

- Signed APK บน Android จริง รับเหตุการณ์จาก API ผ่าน FCM native receiver
- ล็อกหน้าจอ/Doze → รับเหตุการณ์ → notification → เสียงวนตามสิทธิ์ → กด Ack → server หยุด retry
- เก็บ timestamps แต่ละขั้นเพื่อวัด latency ไม่กำหนด SLA จากการทดลองไม่กี่ครั้ง
- ทดสอบ dedupe, expiration, denied permission และ native service start failure พร้อม fallback

### ระยะ B — ระบบใช้งานขั้นต่ำ

- Authentication/device pairing, token rotation, history, receipt, retry worker, outbox และ API key scopes
- Snooze/offline Ack, multi-device any-recipient Ack และ signed APK upgrade
- Security/rate-limit/audit/metrics และเอกสารเชื่อมต่อที่ตรง implementation จริง

### ระยะ C — iOS และการเผยแพร่

- ตรวจ entitlement eligibility, ทดลอง APNs/Critical Alerts และ AlarmKit ตาม use case จริง
- ทบทวน Play/App Store policy และทำ compatibility matrix แยก capabilities ไม่ยืนยันความเท่าเทียมก่อนทดสอบ

| Test matrix ขั้นต่ำ | สิ่งที่ต้องสังเกต |
|---|---|
| เปิดแอป / background / lock screen / Doze | receive, start/fallback, latency และ Ack |
| Notification/full-screen ถูกปฏิเสธ | แจ้ง readiness ตรงจริง ไม่ crash ไม่อ้างว่าส่งเสียงสำเร็จ |
| DND / silent / volume ต่ำ | พฤติกรรมจริงตามสิทธิ์และการตั้งค่า ไม่เหมารวม |
| Force-stop / swipe-away / reboot | แยกกรณีและบันทึกสิ่งที่ไม่รองรับ |
| Offline → online ก่อนและหลัง expiry | ไม่เปิดเหตุการณ์หมดอายุ; pending actions sync ถูกต้อง |
| ข้อความซ้ำ/ผิดลำดับ/Ack แข่ง retry | ไม่เปิดเสียงซ้อนหรือปลุกใหม่หลัง terminal ที่รู้แล้ว |
| หลายเครื่อง / Snooze เครื่องเดียว / Ack อีกเครื่อง | A Ack ขณะ B เล่นเสียง → B หยุดเมื่อรับ terminal state; offline B ใช้ local expiry/reconnect |
| In-flight push ระหว่าง Snooze / restart / sync action เก่า | ไม่เปิดเสียงก่อน snoozed_until และไม่เริ่มนับ duration ใหม่เมื่อ sync |
| Ack พร้อมกัน / Snooze หลังอีกเครื่อง Ack / Cancel แข่ง expiry | canonical Ack คงเดิม; terminal ไม่ย้อนกลับ active; status code ตรง contract |
| Provider/queue ล้มเหลวและ token หมดอายุ | ไม่สูญงานที่ accepted; backoff และ disable invalid token |
| คนละ tenant/เป้าหมายนอก scope/ID เดาสุ่ม | ไม่ข้ามสิทธิ์ ไม่รั่วข้อมูล |
| APK update และ process restart | durable state และ signing continuity |

ทดสอบ Android 13, 14, 15 และรุ่นใหม่ล่าสุดที่เลือก support รวม Pixel/AOSP และเครื่อง OEM ที่ผู้ใช้ใช้จริง เกณฑ์ product เช่นเสียง/หน้าจอเหมาะสมและรบกวนมากน้อยต้องให้ผู้ใช้ยืนยัน ส่วนการทำงานให้บันทึกผลจากอุปกรณ์จริง ไม่ใช้เอกสารนี้เป็นหลักฐานว่าทดสอบผ่านแล้ว

## 10. Integration checklist และเรื่องที่ต้องตัดสินใจ

- [ ] ยืนยัน Android versions/ยี่ห้อเครื่องเป้าหมาย และแจก APK ภายในหรือมีแผนขึ้นสโตร์
- [ ] ยืนยันว่าใช้ Google Play services ได้หรือจำเป็นต้องรองรับเครื่องไม่มี GMS (เส้นทาง FCM นี้ไม่ครอบคลุมทุกเครื่อง)
- [ ] ยืนยัน Backend เดิม, authentication, hosting, จำนวนผู้ใช้/เครื่อง และอัตราเหตุการณ์
- [ ] ยืนยันระดับเสียง/เวลาสูงสุด/Snooze และนโยบายหนึ่งคน Ack เท่ากับจบทั้งกลุ่ม
- [ ] ตัดสิน final schema/limits, retry/expiry/clock skew และอายุเก็บข้อมูล/Audit
- [ ] ตั้ง Firebase project/service credentials แบบ secret และ application identity/signing key
- [ ] สร้าง PoC native alarm และทดสอบ matrix ก่อนลงทุนหน้าจอเต็ม
- [ ] ตรวจ Play policy/FGS types/full-screen declaration ตาม implementation จริง
- [ ] กำหนด fallback/escalation ที่ไม่พึ่ง push ช่องทางเดียวสำหรับเหตุการณ์สำคัญ
- [ ] ยืนยัน iOS entitlement และการยอมรับข้อจำกัดก่อนใส่ในข้อเสนอรับประกันความสามารถ

## 11. แหล่งอ้างอิงทางการ

ตรวจผ่าน HTTP ในรอบสำรวจ 19 ตุลาคม 2026 เนื้อหาและนโยบายอาจเปลี่ยน ต้องตรวจอีกครั้งเมื่อเลือก SDK/ส่งสโตร์

1. Pushover API — https://pushover.net/api
2. Flutter build Android — https://docs.flutter.dev/deployment/android
3. Flutter native platform channels — https://docs.flutter.dev/platform-integration/platform-channels
4. Firebase Flutter client — https://firebase.google.com/docs/cloud-messaging/flutter/client
5. Firebase Android priority — https://firebase.google.com/docs/cloud-messaging/android/message-priority
6. Firebase Android receive — https://firebase.google.com/docs/cloud-messaging/android/receive
7. Firebase Flutter receive/force-quit — https://firebase.google.com/docs/cloud-messaging/flutter/receive
8. Android foreground-service restrictions — https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
9. Android foreground-service types — https://developer.android.com/develop/background-work/services/fgs/service-types#media
10. Android notification permission — https://developer.android.com/develop/ui/views/notifications/notification-permission
11. Full-screen intent limits — https://source.android.com/docs/core/permissions/fsi-limits
12. Google Play full-screen/FGS requirements — https://support.google.com/googleplay/android-developer/answer/13392821?hl=en
13. Android 15 stopped state — https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state
14. Android scheduled alarms — https://developer.android.com/develop/background-work/services/alarms/schedule
15. Notification policy access — https://developer.android.com/reference/android/app/NotificationManager#isNotificationPolicyAccessGranted()
16. Apple Critical Alerts — https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/criticalalert
17. Apple AlarmKit — https://developer.apple.com/documentation/alarmkit
18. Apple background push — https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app
19. Notifee foreground service — https://notifee.app/react-native/docs/android/foreground-service/
20. ntfy mobile — https://docs.ntfy.sh/subscribe/phone/
21. ntfy configuration/iOS upstream — https://docs.ntfy.sh/config/
22. Gotify docs — https://gotify.net/docs/
23. Kotlin Multiplatform — https://kotlinlang.org/docs/multiplatform/get-started.html
24. Jetpack Compose — https://developer.android.com/develop/ui/compose
25. FCM message types/payload limit — https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type
