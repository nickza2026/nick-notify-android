# รับทราบบน Android → Server (Ack sync)

เอกสาร integration สำหรับ PoC เครื่องเดียว รุ่น 0.4: ติดตามผล build/tests/การทดสอบจริงที่ [validation](validation-android-poc-th.md) ไม่ถือว่าการมีโค้ดแปลว่า Pixel ส่งกลับสำเร็จแล้ว

## 1. พฤติกรรมที่ต้องรักษา

- กดรับทราบต้องหยุดเสียง **ในเครื่องทันที** ไม่รอ HTTP, DNS หรืออินเทอร์เน็ต
- บันทึก local tombstone กันข้อความเดิมปลุกซ้ำ และเก็บ pending Ack แบบ durable
- งานส่งกลับทำผ่าน WorkManager เมื่อมี network ตามที่ Android อนุญาต ไม่รับประกันว่าจะส่งทันที โดยเฉพาะ Doze/Force-stop
- ก่อนรับ route ใหม่จะบันทึก periodic reconciler แบบอิสระ เพื่อกู้ช่องว่างกรณี process ตายหลังบันทึก local Ack แต่ก่อนจัดคิว one-shot รอบทันที ใช้ช่วงขั้นต่ำ 15 นาทีตาม WorkManager แต่ไม่ใช่ SLA ว่าจะส่งภายใน 15 นาที และ Force-stop ยังต้องรอผู้ใช้เปิดแอป
- UI แยก local stop, pending remote Ack, server confirmation และรายการเก่าที่ไม่มี route
- Delivery expiry ไม่ใช่ Ack expiry และไม่หยุดเสียงที่เริ่มแล้ว

## 2. สิทธิ์: ไม่ฝัง application API key ลง APK

Server สร้าง random capability เฉพาะ alert แล้วแนบ FCM data เพิ่ม:

```json
{
  "type": "alert",
  "alert_id": "incident-unique-id",
  "title": "เหตุการณ์ทดสอบ",
  "message": "กรุณารับทราบ",
  "expires_at": "2026-10-19T12:00:00Z",
  "ack_url": "https://alerts.example.com/v1/alerts/incident-unique-id/ack",
  "ack_token": "<per-alert-capability-not-a-real-token>"
}
```

URL เป็นตัวอย่างเท่านั้น ต้องเปลี่ยนเป็น HTTPS จริงที่มือถือเข้าถึงได้ Token ใช้รับทราบได้เฉพาะ alert นั้น ไม่ใช่สิทธิ์ส่ง alert ใหม่หรืออ่านรายการทั้งหมด Server เก็บ hash ไม่เก็บ capability plaintext ใน ledger; app เก็บ route/token ใน private storage และไม่แสดงใน log/UI

**ผู้ที่มี capability สามารถรับทราบเหตุการณ์นั้นได้** จึงต้องปกป้อง FCM payload/private storage และรักษา HTTPS การยืนยันเป็นหลักฐานว่าผู้ถือ capability ส่ง Ack ไม่ใช่หลักฐานยืนยันตัวบุคคลด้วยชื่อ/บัญชี และไม่ใช่หลักฐานว่าได้ยินเสียงจริง

ไม่ใช้ `google-services.json`, FCM registration token หรือ service-account private key เป็น credential ของ Ack endpoint

## 3. URL และ TLS

- ตั้ง `ACK_PUBLIC_BASE_URL` ให้ Node bridge เช่น `https://alerts.example.com` หรือ HTTPS base path ที่ reverse proxy map ถึง bridge ได้
- ต้องไม่ใช่ `localhost` ที่มือถือเข้าถึงไม่ได้ ต้องมี DNS/routing/certificate ที่มือถือเชื่อถือ และ route `/v1/alerts/{id}/ack` ถึง instance เดียวกับ ledger
- Server/Android ไม่ใช้ HTTP เป็น fallback ไม่ปิด certificate verification และไม่ส่ง capability ตาม HTTP redirects
- ปัจจุบันตัว bridge รับ HTTP ที่ loopback แล้วให้ reverse proxy/Ingress terminate TLS ไม่ทำ port forwarding หรือเปิด API สู่อินเทอร์เน็ตให้อัตโนมัติ
- หากยังไม่ตั้ง public URL จะใช้เส้นทางส่งเตือนเดิมได้ แต่ข้อความไม่มีช่องทาง Ack และ health ต้องรายงาน `ack_sync_supported:false`

## 4. Contract

### รับทราบ

```http
POST /v1/alerts/{alert_id}/ack
Authorization: Bearer <per-alert-capability>
Content-Type: application/json
```

```json
{
  "client_acked_at": "2026-10-19T12:01:00Z",
  "client_action_id": "11111111-1111-4111-8111-111111111111"
}
```

Client time เป็น telemetry ไม่ใช่เวลาหลักของระบบ Server ต้องบันทึกสำเร็จแบบ durable ก่อนตอบ 200:

```json
{
  "alert_id": "incident-unique-id",
  "status": "acknowledged",
  "acknowledged_at": "2026-10-19T12:01:02Z"
}
```

เรียกซ้ำด้วย capability เดิมต้องคืน canonical Ack เดิม ไม่เลื่อนเวลารับทราบทุกครั้ง Android ยืนยันเฉพาะ 200 ที่ parse ได้และ ID/status/เวลา server ถูกต้อง ไม่ถือว่า generic 2xx, หน้า HTML ของ proxy หรือ redirect แปลว่า Ack สำเร็จ

`client_action_id` ระบุการกดรับทราบที่มีเหตุการณ์ active หนึ่งครั้ง กดรับทราบทั้งหมดหนึ่งครั้งใช้ ID เดียวกันกับหลาย alert; network retries ของ action เดิมใช้ ID เดิมเสมอ ปุ่มที่ไม่มีเหตุการณ์ active ไม่สร้าง action ใหม่ รายการเก่าใช้ deterministic fallback ID เพื่อไม่เพิ่มจำนวนทุกครั้งที่ retry ฝั่ง Node bridge ยังคง canonical receipt แรกเท่านั้น ส่วนประวัติหลาย action/สถิติแยกเป็นงาน Go/PostgreSQL dashboard รุ่นถัดไป ไม่ใช่นับจำนวน HTTP requests ว่าเป็นจำนวนกด

### อ่าน receipt

`GET /v1/alerts/{alert_id}` ใช้ **application Bearer API key ฝั่ง server/caller** ไม่รับ capability เป็นสิทธิ์อ่าน ห้ามนำ application key ไปใส่ใน APK หรือ URL

Provider acceptance, device receipt, playback และ explicit acknowledgement เป็นคนละหลักฐาน Server timestamp หมายถึงเวลารับ Ack ส่วนเวลาที่ผู้ใช้กดขณะออฟไลน์อาจเก่ากว่านั้นและขึ้นกับนาฬิกาเครื่อง

## 5. Retry / offline / migration

- Connection/read timeout, network error, HTTP 429/5xx: เก็บ pending และ retry แบบ exponential backoff ภายใต้ WorkManager constraints
- 401/403/404 หรือ response schema ผิด: ไม่ลบ local Ack และไม่รายงาน confirmed ให้เห็นสถานะติดขัดเพื่อแก้ server/route แล้วลองใหม่
- ส่งเป็น batch จำกัดขนาด ไม่ให้รายการเสียหนึ่งรายการกันรายการอื่นทั้งหมด
- ป้องกัน crash window ระหว่างบันทึก server confirmation กับล้าง pending โดยบันทึก receipt แบบ durable และ reconcile เมื่อรอบถัดไปเริ่ม
- หลัง server ยืนยัน เก็บ confirmation tombstone แล้วลบ plaintext capability ในเครื่อง ไม่หมุน token ของ ID เดิมจาก replay และไม่รายงาน GET receipt จากสถานะ server ที่ยังเขียนดิสก์ไม่เสร็จ
- เหตุการณ์ local test/ข้อความจากรุ่นเก่าที่ไม่มี `ack_url`/`ack_token` จะไม่สามารถส่ง Ack ย้อนหลังโดยเดา credential ได้ ให้แสดงแยกจากรายการที่ sync ได้
- เก็บข้อมูล alert/ledger แยกจาก idempotency retention ของคำขอส่ง ไม่ลบ unacknowledged record เพราะ delivery TTL หมด และปฏิเสธงานใหม่เมื่อชน capacity แทน silently evict
- ยังคงเป็น single-process filesystem state: **1 replica + Recreate + PVC** การเพิ่ม Ack ไม่ทำให้รองรับ active workers หลายตัว
- ข้อจำกัด Node PoC: ledger สูงสุด 5,000 records และ Android เก็บ route ที่ยังไม่ confirmed ได้สูงสุด 1,000 ไม่ลบ pending เงียบ ๆ; ข้อมูลยืนยันแบบ tombstone ยังต้องวาง retention/archival ในงาน production/Go migration ต่อไป

## 6. Checklist ทดสอบก่อนใช้จริง

- [ ] ทดสอบด้วย fake FCM ว่า capability ผูกเฉพาะ alert และไม่มี token plaintext ใน ledger/receipt response
- [ ] Ack ซ้ำ/restart คง canonical server time; API key ไม่ใช้แทน device capability
- [ ] ยัง Ack ได้หลัง delivery expiry และ unknown/reused alert ID ไม่หมุน token ของ incident เดิม
- [ ] Payload byte budget รวม URL/token ไม่เกินค่าที่รองรับ
- [ ] Android ปฏิเสธ HTTP/redirect/header injection และไม่ล้าง pending จาก response ที่ ID/status ไม่ตรง
- [ ] HTTPS reverse proxy ใช้งานได้จาก Pixel จริง โดยไม่ redirect Ack URL
- [ ] ส่งเหตุการณ์ใหม่หลังติดตั้ง 0.4 → กดรับทราบ → เสียงหยุด → UI confirmed และ GET receipt แสดง Ack
- [ ] ออฟไลน์แล้วกดรับทราบ เสียงหยุดก่อน จากนั้นกลับออนไลน์และ server รับ Ack โดยไม่เปิดเสียงใหม่
- [ ] เมื่อ server ล่ม/401/429/5xx และ app process ตาย คิวไม่สูญ และ UI ไม่อ้างว่า server รับแล้ว

การทดสอบที่ทำให้มือถือดังต้องแจ้งผู้ใช้ก่อน ไม่ยิง incident ใหม่ซ้ำเพียงเพราะยังไม่ได้ยินผลตอบกลับ
