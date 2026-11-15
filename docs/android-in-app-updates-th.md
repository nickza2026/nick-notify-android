# อัปเดต APK จากใน Notify Alarm

ระบบนี้สำหรับ APK ที่ติดตั้งเอง ไม่ใช้ Play Core หรือบัญชี GitHub บนมือถือ แอปอ่านรุ่นที่เผยแพร่จาก GitHub Releases สาธารณะของ `nickza2026/nick-notify-android` และเปิดตัวติดตั้งของ Android เมื่อผู้ใช้กดเอง ไม่มี GitHub token หรือ application API key ฝังเพิ่มใน updater

## ครั้งแรกและการใช้งานครั้งถัดไป

ต้องติดตั้ง APK รุ่นที่มี updater ก่อนหนึ่งครั้ง รุ่นเริ่มต้นของฟีเจอร์คือ `versionCode 8 / 0.8.0-in-app-updates` ใช้ไฟล์ที่ signed ด้วย key เดิมจาก manual workflow แล้วติดตั้งทับ ไม่ถอนแอปหรือล้างข้อมูล รุ่น local debug ที่ใช้คนละ signing certificate ไม่ใช่ไฟล์อัปเกรดสำหรับ Pixel เดิม

เมื่อมีรุ่นใหม่กว่า:

1. เปิดแอปแล้วกด **ตรวจรุ่นอัปเดต**
2. กด **ดาวน์โหลดและตรวจสอบ APK** แอปตรวจขนาด, SHA-256, package, version และ signing certificate
3. กด **ติดตั้งรุ่นที่ตรวจแล้ว** หากยังไม่อนุญาตแหล่งติดตั้ง Android จะแสดง Settings ให้ผู้ใช้เลือกเอง หลังกลับมาให้กดติดตั้งอีกครั้ง ไม่มีการเปิดตัวติดตั้งอัตโนมัติจากการกลับเข้าแอป
4. ยืนยันในตัวติดตั้งของ Android แล้วตรวจหมายเลขรุ่นหลังเปิดแอปใหม่ การส่งไฟล์ให้ตัวติดตั้งยังไม่ใช่หลักฐานว่าติดตั้งสำเร็จ

ถ้ารุ่นที่เผยแพร่ไม่ใหม่กว่ารุ่นที่ติดตั้ง จะไม่มีไฟล์ให้ติดตั้งทับหรือลดรุ่น หากยังไม่มี release ที่เผยแพร่ ผล 404 ของ feed หมายถึงยังไม่มีรุ่นสำหรับ updater ไม่ใช่ความล้มเหลวของบริการแจ้งเตือน

## ข้อจำกัดด้านเสียงปลุกและข้อมูล

แอปบล็อกการเริ่มงานอัปเดต/ส่งต่อให้ตัวติดตั้งเมื่อมี critical incident ค้างอยู่ และบล็อกเมื่ออ่านสถานะเหตุการณ์ไม่ได้ ไม่มีการ Ack, ปิดเสียง, logout หรือล้าง pending Ack เพื่อให้อัปเดตผ่าน ข้อมูลบัญชีและเหตุการณ์ยังอยู่ในพื้นที่แอปเดิมเมื่อ Android ติดตั้งทับตามปกติ

การติดตั้ง APK อาจหยุด process ของแอป เหตุการณ์ใหม่ที่มาหลังเปิดหน้าติดตั้งของระบบยังอาจถูกขัดจังหวะได้ จึงควรอัปเดตในช่วงที่ผู้ใช้เฝ้าเครื่องอยู่และไม่มีเหตุการณ์สำคัญ การตรวจในแอปไม่ใช่การรับประกันเสียงหรือ FCM ในทุกสถานะ Android

ไฟล์ที่ส่งให้ตัวติดตั้งแล้วเก็บแยกและไม่ถูกเขียนทับขณะยังไม่รู้ผล เมื่อกลับเข้าแอปหลังยกเลิกต้องกดตรวจรุ่นและดาวน์โหลดใหม่ ไม่ใช้ callback เก่ามาเปิดติดตั้งเอง แคชมี quota 256 MiB รวมการจองของงานที่กำลังดาวน์โหลด และเก็บกวาดไฟล์รุ่นที่ยืนยันได้ว่าติดตั้งถึงรุ่นนั้นแล้ว หากพื้นที่ไม่พอจะปฏิเสธการดาวน์โหลดเพิ่มแทนลบไฟล์ที่ตัวติดตั้งอาจยังใช้อยู่ ข้อความแนะนำให้ล้าง **แคช** ผ่าน Android Settings ไม่ใช่ล้างข้อมูลแอปหรือถอนติดตั้ง และควรทำในช่วงไม่มีเหตุการณ์สำคัญ

ก่อนจองพื้นที่ดาวน์โหลด จะตรวจพื้นที่ว่างและการจองที่กำลังทำอยู่ โดยเว้นอย่างน้อย 32 MiB สำหรับการบันทึกเหตุการณ์/Ack แยกจาก quota ของ updater การตรวจนี้ไม่ได้ควบคุมการใช้พื้นที่ของแอปอื่นหรือระบบ Android

## สร้างไฟล์กับเผยแพร่เป็นคนละขั้น

Workflow `.github/workflows/android-apk.yaml` ยังคง manual-only และ signed job เฉพาะ `main`:

- `publish_update=false` ซึ่งเป็นค่าเริ่มต้น: สร้าง signed artifact และ descriptor สำหรับดาวน์โหลดจาก Actions เท่านั้น แอปยังตรวจไม่เจอ artifact นี้
- `publish_update=true`: หลัง signed build ผ่าน จึงเริ่ม publisher อีก job ที่มี `contents: write` เฉพาะ job นั้น ตรวจไฟล์ที่ดาวน์โหลดจาก artifact ของ run เดียวกันซ้ำ แล้วสร้าง public release/tag `android-v<version_name>` ผูกกับ commit ของ run นั้น

APK asset ใช้ชื่อ `notify-alarm-<version_name>-debug.apk` คู่กับ `notify-alarm-update.json` Publisher ไม่เขียนทับ tag/release เดิม การเผยแพร่ครั้งแรกทำให้ APK ดาวน์โหลดได้สาธารณะ รวมถึง Firebase client configuration ที่ต้องอยู่ใน APK แต่ไม่มีเหตุผลให้ใส่ service-account หรือ backend credential ลง APK

การ push, เปิด PR หรือ merge ไม่เริ่ม Android signing/publication เอง การอนุมัติให้เขียนฟีเจอร์นี้ไม่ใช่การอนุมัติใช้ private signing material, publish release หรือติดตั้งบนมือถือจริง

เมื่อออกเวอร์ชันถัดไป ต้องเพิ่ม `versionCode` และปรับ version/name ใน Gradle, workflow และ release producer ให้ตรงกัน Tests ตรวจความสอดคล้องก่อนเข้าถึง private setup ไม่แก้ certificate pin เพื่อแก้ปัญหาติดตั้งทับ

## Feed และ descriptor

Feed คือ `https://api.github.com/repos/nickza2026/nick-notify-android/releases/latest` เลือกเฉพาะ release ปกติ ไม่ใช่ draft/prerelease และ tag ต้องเป็น `android-v<version_name>` Asset URL อยู่ใน release ของ repository/tag เดียวกัน การดาวน์โหลดใช้ HTTPS และตรวจ redirect เฉพาะ host ที่รองรับ

Descriptor มี schema version 1 และใช้ fields เหล่านี้เท่านั้น:

| Field | ชนิด/ค่า |
|---|---|
| `schema_version` | integer `1` |
| `application_id` | string `dev.notifyalarm` |
| `version_code` | integer บวก ไม่เกิน `2147483647`; ติดตั้งได้เฉพาะค่าที่สูงกว่ารุ่นที่ใช้อยู่ |
| `version_name` | string รุ่นเดียวกับ tag และ APK เช่น `0.8.0-in-app-updates` |
| `apk_asset` | string `notify-alarm-<version_name>-debug.apk` |
| `apk_sha256` | SHA-256 ของ bytes ของ APK เป็น lowercase hex 64 ตัว |
| `apk_size` | integer จำนวน bytes ตั้งแต่ 1 ถึง `134217728` (128 MiB) |
| `signing_cert_sha256` | string fingerprint เดิม `79c26a1c9329aa69933eada6c5e13b7718d43ae1da90120de639fe23f10cc9d4` |

Producer สร้าง descriptor จาก APK ที่ Android SDK ตรวจ package/version และ signature แล้ว ไม่ให้ผู้ใช้กรอก hash/size เอง และไม่ทิ้ง descriptor เก่าที่ดูเหมือนเพิ่งสร้างเมื่อการตรวจรอบใหม่ล้มเหลว Hash ใช้ตรวจความตรงกันของไฟล์จากแหล่งที่เชื่อถือได้ ไม่ได้แทนการตรวจลายเซ็นหรือทำให้ APK จากแหล่งใดก็ได้ปลอดภัย

## การตรวจในเครื่องและขอบเขตหลักฐาน

```text
node --test tools/test-android-apk-workflow.mjs tools/test-android-update-release.mjs tools/test-standalone-nortezh.mjs
```

Node tests ใช้ SDK/APK จำลอง ไม่อ่าน private key และไม่ publish จริง Android JVM tests/build/lint ต้องใช้ Android SDK ที่มี platform 36 และ build-tools 36.0.0 ผล local synthetic tests ไม่ยืนยันการติดตั้งผ่านตัวติดตั้งจริง, การรับแจ้งเตือนระหว่างติดตั้ง หรือ upgrade บน Pixel ต้องทดสอบกับ APK signed เดิมและความยินยอมใช้เครื่องแยกต่างหาก

สำหรับ Windows ที่ติดตั้ง SDK แยกในโปรเจ็กต์ ใช้ `.local-tools/android-sdk` ซึ่งถูก gitignore ไว้ `scripts/build-android.ps1 -WithTests` จะเลือก SDK นี้เมื่อยังไม่ได้ตั้ง `ANDROID_HOME` และมี platform 36 แล้ว โดยคืนค่า environment ของ shell หลังจบ ไม่ตั้งค่าระดับ Windows ผล build ในเครื่องยังเป็น local debug APK ไม่ใช่ไฟล์ signed ด้วย key เดิมสำหรับอัปเดต Pixel

### ผลตรวจ local รุ่น 0.8.0 (15 พฤศจิกายน 2026)

- Workflow/release fixtures และ Bash guards: 35/35 ผ่าน
- Android JVM/Robolectric: 44/44 ผ่าน ไม่มี failure/error/skip รวมกรณีสถานะ critical เสียหาย, ไฟล์ถูกแก้ไข, queued cancellation, installer return/retry, cache quota และพื้นที่ว่างต่ำ
- `assembleDebug`, `assembleDebugAndroidTest`, `testDebugUnitTest`, `lintDebug` ผ่าน โดย instrumentation APK เป็นการ compile เท่านั้น ไม่ได้รันทดสอบบนเครื่อง Android
- Lint ไม่มี error/fatal แต่มี 43 warnings จึงไม่ใช่ผลว่าโครงการไม่มี warnings

ใช้ frozen source snapshot ที่ hash ตรงกับ source ใน checkout โดยไม่รวม private Firebase resource และไม่ใช้ key เดิมจาก CI ผลนี้ยังไม่ยืนยันตัวติดตั้ง/permission UI, การคงข้อมูลหลังอัปเกรดจริง หรือเสียง/FCM บน Pixel ไม่มีการ publish release หรือติดตั้งบนมือถือจากการตรวจครั้งนี้
