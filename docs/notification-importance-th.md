# ระดับแจ้งเตือน: normal / critical

## Contract

Service เรียก `POST /v1/alerts` ตาม [คู่มือ API](service-integration-th.md) พร้อม `importance` ได้สองค่า:

| ค่า | ผลที่ออกแบบบน Android รุ่นรองรับ |
|---|---|
| `normal` | notification เงียบผ่าน channel แยก ไม่สั่น ไม่เริ่ม MediaPlayer/audio focus/foreground alarm service และไม่มี full-screen intent |
| `critical` | เสียงปลุกต่อเนื่องตามพฤติกรรมเดิม ต้องกดรับทราบเองจึงหยุด |
| ไม่ส่ง field | เท่ากับ `critical` เพื่อรักษา client/ข้อมูลเก่า |
| null, ค่าว่าง, ค่าอื่น | API ปฏิเสธ ไม่เปลี่ยนเป็นวิกฤตหรือธรรมดาให้เอง |

ระดับไม่ใช่ผลการส่ง: `provider_accepted` ยังไม่ยืนยันมือถือได้รับ/ดัง และ status เดิมไม่เปลี่ยนตามระดับหรือการกด Ack Dashboard แสดงระดับแยกในตาราง การ์ดมือถือ และรายละเอียด

**normal ไม่ได้หมายถึง mute ทั้งโทรศัพท์:** ถ้ามี critical กำลังดัง เสียง critical ต้องดังต่อ normal ไม่หยุด/ลดเสียงนั้น การเปิดแอปหรือ retry/reconcile ของ normal ก็ต้องไม่สร้างเสียงใหม่เช่นกัน Notification/lock-screen appearance ยังขึ้นกับ permission และ settings ของ Android

## การเก็บและ retry

- PostgreSQL startup migration เพิ่มค่าเริ่มต้น critical ให้ประวัติเดิม ไม่เปลี่ยนข้อมูลเก่าให้เป็น normal และไม่ลบประวัติ
- Node baseline อ่าน record เก่าที่ไม่มีระดับเป็น critical เช่นกัน ไม่ต้องย้ายข้อมูลย้อนหลังเพื่อเปลี่ยนค่า
- key/body เดิมต้อง replay ผลเดิม การไม่ส่ง importance กับส่ง critical ชัดเจนต้องเข้ากันได้กับ idempotency เก่า การเปลี่ยนเป็น normal ด้วย key เดิมเป็น conflict
- หนึ่ง UUID `client_action_id` ต่อ human Ack-all หนึ่งครั้ง ใช้ UUID เดิมข้าม alerts และ retries ไม่ว่าระดับใด การ swipe notification ไม่ใช่การรับทราบและไม่ใช่คำสั่งหยุด critical
- TTL ใช้ป้องกันการเริ่ม alert เก่าที่เพิ่งได้รับ ไม่ใช่ timer หยุดเสียง critical ที่เริ่มแล้ว ตู้กลับ ON ไม่ใช่การกดของคน

## Transport กับระดับความสำคัญเป็นคนละเรื่อง

Backend ส่ง normal ด้วย FCM delivery priority `NORMAL` และ critical ด้วย `HIGH` การส่งแบบ NORMAL อาจล่าช้าเมื่อ Doze/background ไม่มีสัญญาว่าจะทันที เมื่อหมด latest-start TTL ก่อนรับจึงอาจไม่แสดง

อย่าปรับ FCM priority เป็น NORMAL เพียงอย่างเดียวเพื่อหวังว่าจะทำให้ APK เก่าเงียบ APK ต้องมีเส้นทาง normal โดยตรง และห้ามส่ง normal เข้า critical-failure/recovery path เมื่อ transport ไม่ใช่ HIGH

Wire format ใน FCM data แยกด้วย: critical ใช้ `type=alert`, normal ใช้ `type=notice` พร้อม `importance=normal` เพื่อให้ APK เก่าที่รู้จักเฉพาะ alert **ข้าม notice** แทนเก็บเป็น alarm แล้วเผลอปลุกภายหลัง ดังนั้นเครื่องเก่าจะไม่แสดง normal จนกว่าจะอัปเดต APK ไม่ใช่การยืนยัน delivery บนเครื่องเก่า

## การตรวจรับบน Pixel (ต้องทดสอบจริงภายหลัง)

APK ที่รวม importance และตัวแก้ความปลอดภัยล่าสุดคือ **0.6.0-safety-poc / versionCode 6** ที่ `artifacts/notify-alarm-0.6.0-safety-debug.apk` ตรวจ signature แล้วตรงกับ APK 0.5.0 เดิม ให้ติดตั้งทับแอปเดิมก่อน ไม่ต้องล้างข้อมูล/ถอนติดตั้งซึ่งอาจทำให้ tombstones และ pending Ack หาย APK 0.5.0 ยังมีสองระดับ แต่ยังมีทางให้ terminal จาก server ปิด critical ได้

ผล local/synthetic ก่อนหน้านี้: Go/PostgreSQL 17 เคส + vet, Node 33 เคส, dashboard unit 6 เคส/typecheck/build และ browser desktop/mobile/detail ทั้งสองระดับผ่าน รอบแก้ความปลอดภัย 26 ต.ค. รัน Android JVM **14 เคส** พร้อม assemble debug/test APK และ lint ผ่านแบบ offline; ไม่ได้รัน Go/Node/dashboard ซ้ำ ผลเหล่านี้ยังไม่ยืนยันส่งถึง Pixel

การผ่าน Go/Node/JVM/browser tests ไม่เท่ากับยืนยันเครื่องจริง ต้องติดตั้ง APK รุ่นใหม่และตรวจด้วยข้อมูลสังเคราะห์ที่ตั้งใจส่ง:

1. ส่ง normal เมื่อไม่มี alarm: มี notification/ข้อความ ไม่มีเสียง สั่น หน้าปลุก หรือ FGS alarm จากรายการนี้
2. เปิดแอปหลังรับ normal และเปิดใหม่หลัง process ถูกสร้างใหม่: ไม่เริ่มเสียงเพราะ normal ที่ค้างอยู่
3. ส่ง critical: เสียงดังต่อเนื่องจนกดรับทราบ ตรวจด้วยความยินยอมและสภาพแวดล้อมที่พร้อมรับเสียง
4. ส่ง normal ระหว่าง critical: critical ดังต่อ normal ไม่เริ่ม player ใหม่และใช้ notification แยก
5. รับทราบ/ยุติ critical ตัวสุดท้ายขณะมี normal ค้าง: เสียง/FGS หยุด normal ไม่แปลงเป็น alarm
6. ทดสอบ Ack ตอน offline แล้วต่ออินเทอร์เน็ต: ไม่มีเสียงกลับมา และ retries ไม่เพิ่มจำนวนการกด
7. ทดสอบ missing importance เป็น critical และ normal ที่ล่าช้า/ซ้ำ/หมด TTL ไม่หลุดไปปลุก
8. ขณะ critical ค้าง รับ FCM `cancelled`/`acknowledged` ทั้งก่อนและหลัง alert: critical ไม่หาย ไม่สร้าง human Ack และกดรับทราบบนเครื่องเท่านั้นจึงหยุด; normal ที่แสดงอยู่ยังปิดได้ด้วย remote terminal
9. ขัดจังหวะเสียงด้วยสายโทรศัพท์/แอปอื่น: มีสถานะแจ้งว่าเสียงไม่ทำงานและลองขอ audio focus ใหม่ภายใน 5–30 วินาทีขณะ service ยังอยู่; หาก service หยุดโดยมี `onDestroy` จะคงเหตุการณ์และแสดง failure notification แต่ process kill อาจไม่เรียก callback หรือไม่แสดง notification ใหม่ ต้องเปิดแอปกดเริ่มใหม่ ไม่อ้างว่า OS จะปล่อยเสียงให้ทำงานทุกครั้ง

ยังไม่ส่ง FCM หรือเล่นเสียงบน Pixel อัตโนมัติจากการทดสอบใน repository และยังไม่อ้างว่า Pixel Ack→Go/PostgreSQL ผ่านจนกว่าจะมี HTTPS URL และตรวจจริง
