# ระดับแจ้งเตือน: normal / urgent / critical

ฉบับนี้อธิบาย API สามระดับและ APK `0.10.0-notification-levels` / versionCode `11` ซึ่งยังไม่เผยแพร่ ไม่มีการส่ง FCM หรือยืนยันเสียงบนเครื่องจริงจากผลทดสอบในเครื่อง

## Contract

`POST /v1/alerts` รับ `importance` ตามตาราง ส่วน request/response, authentication, errors และ retry อยู่ใน [API สำหรับระบบอื่น](service-integration-th.md)

| ค่า | พฤติกรรม Android รุ่นรองรับ |
|---|---|
| `normal` | ข้อความเท่านั้น: notification เงียบ ไม่สั่น ไม่มี full-screen ไม่เรียก audio focus หรือ alarm foreground service |
| `urgent` | notification เงียบ + เสียงครั้งเดียว (ไม่วน) ผ่าน**เสียงปลุก** (`USAGE_ALARM`) จึงดังแม้เครื่องอยู่โหมดเงียบ/สั่น ใช้ระดับเสียงปลุกที่ตั้งไว้ (ไม่ยกระดับให้) ไม่สั่น ไม่มี full-screen หรือ alarm foreground service |
| `critical` | ใช้เสียงปลุกวนต่อเนื่องจนกดรับทราบบนเครื่อง ดังแม้โหมดเงียบ/สั่น ยกระดับเสียงปลุกขั้นต่ำ 80% เป็นค่าเริ่มต้น ภายใต้ข้อจำกัด DND ด้านล่าง |
| ไม่ส่ง field | เท่ากับ `critical` เพื่อรักษาข้อมูลและ caller เดิม |
| null, ค่าว่าง, ค่าอื่น | ปฏิเสธ ไม่แปลงเป็นระดับอื่นให้เอง |

normal/urgent ไม่หยุด ลดเสียง หรือเริ่ม player ใหม่แทน critical ที่กำลังดัง ระดับแจ้งเตือนไม่ใช่ผลการส่ง `provider_accepted` ไม่ยืนยันว่ามือถือได้รับหรือมีเสียงจริง

**ตั้งเครื่องเป็นเงียบจากหน้าเว็บ:** เจ้าของบัญชีตั้งรายเครื่องได้ที่หน้าอุปกรณ์ ([สัญญา FE](fe-device-silent-th.md)) เครื่องที่ตั้งเงียบได้รับ urgent/critical ใหม่เป็น `normal` (ข้อความเท่านั้น) เครื่องอื่นยังดังตามระดับ ประวัติยังเก็บระดับที่ส่งขอ

urgent ที่เล่นจาก FCM ไม่มี foreground service และไม่ขอ audio focus: บน Android 15 ระบบอาจไม่ให้ audio focus แก่แอปเบื้องหลัง และ process อาจถูกปิดก่อนเสียงจบ — ยังไม่ได้ยืนยันบนเครื่องจริงว่าดังทุกครั้ง

## TTL, การส่งซ้ำ และการรับทราบ

- `ttl_seconds` เป็นเวลาล่าสุดที่ยังเริ่มแสดง/ปลุกเหตุการณ์ได้ ค่าเริ่มต้น 300 ช่วง 30–10800 วินาที ไม่ใช่เวลาหยุดเสียง critical ที่เริ่มแล้ว
- urgent มีเสียงได้เฉพาะการแสดงครั้งแรก การส่งซ้ำ เปิดแอปใหม่ หรือ reconcile ไม่เล่นเสียงใหม่ ถ้าการโพสต์ครั้งแรกผิดพลาด การลองใหม่แสดงได้แบบเงียบโดยไม่เล่นเสียงซ้ำ
- เหตุการณ์ที่ยังไม่เคยแสดงเมื่อหมด TTL ไม่เริ่มใหม่ การกลับ ON ของตู้ไม่ใช่การรับทราบและไม่หยุด critical
- ทุกระดับมี Ack ได้ urgent ไม่จำเป็นต้องรอ Ack เพื่อหยุดเสียงครั้งเดียว การ swipe notification ไม่ใช่ Ack
- Ack-all หนึ่งครั้งบนเครื่องเดียวใช้ `client_action_id` เดียวข้ามเหตุการณ์และ retries คนละเครื่องแยกการรับทราบ
- คีย์และ body เดิม replay ผลเดิม ไม่ส่งใหม่ การไม่ส่ง importance กับ explicit critical ใช้ hash เดิม normal เดิมไม่เปลี่ยน ส่วน urgent มี hash ของตัวเอง เปลี่ยนระดับด้วยคีย์เดิมเป็น conflict

## โหมดเงียบ, DND และระดับเสียงวิกฤต

เสียงเรียกเข้า/notification กับเสียงปลุกเป็นคนละระดับ critical และ urgent ใช้ `USAGE_ALARM` จึงไม่อาศัยเสียงเรียกเข้า แต่เสียงปลุกเป็นศูนย์ (urgent), DND ที่ห้าม Alarms, audio focus หรือเส้นทางเสียง เช่น Bluetooth ยังทำให้ไม่ได้ยินได้

**ข้อจำกัด DND ที่ Android กำหนด (targetSdk 35):** แอปปิด DND ที่ผู้ใช้เปิดเองไม่ได้ — ตั้งแต่ Android 15 `setInterruptionFilter` สร้างกฎของแอปแทนการเปลี่ยน DND ทั้งเครื่อง ([behavior changes 15](https://developer.android.com/about/versions/15/behavior-changes-15)) และไม่มี API ให้เสียงปลุกดังเมื่อ DND ห้าม Alarms หรือ Total silence สิ่งที่แอปทำ:

- ขอสิทธิ์ `ACCESS_NOTIFICATION_POLICY` (ผู้ใช้กดอนุญาตเองจากปุ่ม "อนุญาตสิทธิ์ Do Not Disturb" ซึ่งเปิด `ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS`) เพื่อให้การยกระดับเสียงปลุกขณะ DND ไม่ถูกปฏิเสธ
- channel `alarm_playback_v1` ขอ `setBypassDnd(true)` — มีผลเฉพาะ channel ที่สร้างใหม่และเฉพาะโหมด DND Priority ([NotificationChannel](https://developer.android.com/reference/android/app/NotificationChannel#setBypassDnd(boolean))) ไม่ได้ทำให้เสียงปลุกที่ถูกห้ามดังได้
- หน้าแอปแสดงสถานะสิทธิ์ และเตือนเมื่ออ่านได้ว่า DND กำลังห้าม Alarms

DND ค่าเริ่มต้นของ Android ส่วนใหญ่อนุญาต Alarms จึงยังดังได้ — ต้องยืนยันบนเครื่องจริง การกลับจาก Settings รีเฟรชสถานะเท่านั้น ไม่เริ่มเสียงเอง

ตัวเลือก **ระดับเสียงขั้นต่ำชั่วคราวขณะวิกฤต** เริ่มต้น**เปิด 80%** ผู้ใช้ปิดหรือเลือกระดับ 1–100% เองได้ในแอป เมื่อ critical เริ่มเล่นจริงจึงยกระดับเสียงปลุกทั้งเครื่องถ้าต่ำกว่าที่เลือก ไม่ลดระดับที่สูงอยู่แล้ว ไม่เปลี่ยนเสียงของ normal/urgent ค่าที่ผู้ใช้เคยบันทึกไว้ในรุ่นก่อนยังใช้ค่าเดิม

เก็บระดับเดิมก่อนปรับเพียงครั้งเดียวในช่วงที่มี critical ซ้อนกัน หลัง Ack ตัวสุดท้าย/หยุด service/เล่นผิดพลาดจึงพยายามคืนระดับเดิม เฉพาะเมื่อยังเป็นค่าที่แอปปรับและไม่เคยตรวจพบการเปลี่ยนโดยผู้ใช้ แอปไม่ดันระดับกลับขึ้นซ้ำเมื่อผู้ใช้ลดเอง

การคืนเสียงเป็น best effort: force-stop/process kill อาจไม่เรียก cleanup เมื่อเปิดแอปครั้งถัดไปจะพยายามคืนค่าที่ค้างไว้โดยไม่เริ่มเสียง หากตรวจพบว่าผู้ใช้เปลี่ยนระดับแล้วจะไม่เขียนทับ ไม่มีการรับประกัน restoration แบบ atomic กับการเปลี่ยนเสียงจาก Settings/แอปอื่น

## Transport และความเข้ากันได้

normal ใช้ FCM `NORMAL` ส่วน urgent/critical ใช้ `HIGH` ระดับ transport ไม่ได้สั่งให้ Android ทะลุ mute หรือ DND การส่งล่าช้า, effective priority ถูกลด, network, permissions, battery/OS หรือแอปถูก force-stop ยังมีผลต่อการรับและเริ่มเสียง เครื่องปิดรับแจ้งเตือนไม่ได้

critical ใช้ FCM data `type=alert`; normal/urgent ใช้ `type=notice` กับ importance ตามจริง APK ที่ไม่รู้จักระดับ notice นั้นข้ามแทนแปลงเป็นวิกฤต urgent จึงต้องอัปเดต APK ก่อนรับ ไม่ใช่เปลี่ยน API แล้วถือว่า APK เก่ารองรับทันที

API อ่านข้อมูลเก่าที่ไม่มี importance เป็น critical ไม่เปลี่ยนประวัติ/คีย์/การรับทราบเดิม ขยาย constraint ด้วย migration ใหม่ 005 โดยไม่แก้ SQL ที่เผยแพร่แล้ว

## การตรวจรับบนเครื่องจริงภายหลัง

ทดสอบด้วยเหตุการณ์สังเคราะห์เมื่อเจ้าของมือถือพร้อมรับเสียง และใช้ APK signer เดิมเพื่อติดตั้งทับโดยไม่ล้างข้อมูล:

1. normal ไม่มีเสียง/สั่น; urgent ดังครั้งเดียวทั้งโหมดปกติ/สั่น/เงียบ (ทั้งตอนแอปเปิดอยู่และอยู่เบื้องหลัง/จอล็อก) และเงียบเมื่อ DND ห้าม Alarms
1. ตั้งเครื่องหนึ่งเป็นเงียบจากหน้าเว็บ แล้วส่ง urgent/critical: เครื่องนั้นแสดงข้อความเท่านั้น อีกเครื่องดังตามระดับ
2. ส่ง urgent ซ้ำหลัง dismiss/เปิดแอปใหม่ไม่ดังซ้ำ การหมด TTL ก่อนแสดงไม่ปลุกย้อนหลัง
3. critical ดังวนจน Ack; normal/urgent/TTL หลังเริ่ม/remote terminal ไม่หยุดเสียงวิกฤต
4. ลองเสียงเรียกเข้าปกติ/เงียบ, ระดับเสียงปลุกศูนย์/ไม่ศูนย์, DND ปิด/อนุญาต Alarms/ห้าม Alarms, Bluetooth และ audio focus interruption บันทึกเสียงที่ได้ยินจริง ไม่ใช้เพียง player state เป็นหลักฐาน
5. ตัวเลือกขั้นต่ำปิดไม่แก้ระดับเสียง; เมื่อเปิด ตรวจการยก/คืนระดับ, critical ซ้อนกัน, ปรับเสียงเอง และกลับจาก Settings โดยไม่มีเสียงเริ่มใหม่
6. Ack ตอน offline หยุดเสียงได้ ต่ออินเทอร์เน็ตแล้ว sync ด้วย action เดิม ไม่เพิ่มจำนวนเพราะ retry ตรวจผลรายเครื่องและประวัติ server แยกจากเสียงที่ได้ยิน

การทดสอบ JVM/Go/PostgreSQL/Node/Web แบบจำลองและ browser loopback ไม่ใช่ผลทดสอบเสียงจริงหรือ Pixel→API Ack จริง

## ข้อกำหนด Android อ้างอิง

- [AudioManager: ระดับเสียงและข้อจำกัดการปรับ](https://developer.android.com/reference/android/media/AudioManager)
- [NotificationManager: DND policy และพฤติกรรม target Android 15 ขึ้นไป](https://developer.android.com/reference/android/app/NotificationManager)
- [NotificationChannel: การตั้งค่าเสียงและ DND ของ channel](https://developer.android.com/reference/android/app/NotificationChannel)
