# คู่มือ Android Alarm PoC — Pixel 6 Pro

## เป้าหมายและขอบเขต

ผู้ใช้ต้องการให้เหตุการณ์ตู้เชื้อเพลิงดับปลุกต่อเนื่องจนตื่นมากดรับทราบเอง ใช้มือถือ Pixel 6 Pro เปิดอินเทอร์เน็ตและให้สิทธิ์ได้ รุ่นแรกจึงพิสูจน์ native alarm ก่อนต่อ Flutter/iOS

- Kotlin/Android native UI และ foreground media playback service
- ใช้เสียงปลุกเริ่มต้นของระบบ และมี PCM tone สำรองในพื้นที่ของแอปเมื่อ URI/ไฟล์เสียงระบบใช้ไม่ได้ ไม่ต้องขอสิทธิ์อ่านไฟล์ภายนอก
- รุ่น 0.2.0 เพิ่มปุ่ม **เลือกเสียงปลุก**: เลือกเสียงจาก Android, นำเข้า audio document สูงสุด 20 MiB, กลับค่าเริ่มต้น หรือใช้เสียงสำรองของแอปโดยตรง บันทึกเป็นค่าของเครื่องและใช้ทั้ง local test/FCM เมื่อเริ่ม player ครั้งถัดไป ไม่เปลี่ยนเสียงที่กำลังเล่นอยู่กลางเหตุการณ์
- ไฟล์นำเข้าถูกคัดลอกลง app-private storage และตรวจว่ามี audio track/ระยะเวลาที่อ่านได้ ไม่ขอสิทธิ์อ่าน media ทั้งเครื่อง จึงยังใช้สำเนาได้เมื่อไฟล์ต้นฉบับถูกย้าย/ลบ และยังมี fallback หากเล่นเสียงที่เลือกไม่ได้
- ปุ่มทดสอบเสียงปลุกวน และปุ่ม **รับทราบทั้งหมด / หยุดเสียง** ในแอป/notification
- เก็บ active incidents, dedupe และ acknowledged IDs ในเครื่อง รองรับหลายเหตุการณ์โดยไม่เปิดเสียงซ้อน
- การรับทราบหยุดในเครื่องได้โดยไม่ต้องมีอินเทอร์เน็ต และเก็บ pending Ack ไว้; เมื่อ alert ใหม่แนบ HTTPS Ack route/capability จะใช้ WorkManager ส่งซ้ำแบบ offline-first โดยยังไม่มีผล Pixel→Go/PostgreSQL จริงมายืนยันรอบนี้
- มี FCM data receiver; ฝั่ง Node→FCM→Pixel เคยดังจริงตามรายงานผู้ใช้ แต่ยังต้องตั้งค่า sender/token ของ Go และตรวจรุ่น 0.6 บนมือถือจริง ห้ามฝัง service-account key ใน APK/source
- ไม่เริ่มเสียงเองหลัง reboot/force-stop และไม่อ้างว่ารับประกันการปลุกทุกสถานะ
- ยังไม่มี full-screen alarm, Snooze, pairing/login, signed production release หรือ iOS

**สำคัญ:** delivery expiry คือเวลาสุดท้ายที่อนุญาตให้เริ่มปลุก เมื่อเริ่มแล้วไม่หยุดตาม expiry และไม่หยุดเพราะตู้กลับมา ON เอง `critical` ที่กำลังค้างจะไม่หยุดด้วย FCM `cancelled`/`acknowledged`; มีเพียงการกดรับทราบบนเครื่องที่ลบเหตุการณ์นั้น ข้อความ terminal จาก server ปิดได้เฉพาะ `normal` ที่มีอยู่แล้ว และไม่ทำ tombstone ให้ ID ที่ยังไม่เคยรับ เพื่อไม่ให้ข้อความที่มาก่อน critical บังเสียงปลุก การกดรับทราบหยุดในเครื่องก่อน sync ไป server

การถูกแย่ง audio focus ทำให้เสียงหยุดชั่วคราวอย่างหลีกเลี่ยงไม่ได้ แอปแสดงสถานะ/notification ว่าเสียงไม่ทำงานและขอ focus ซ้ำแบบเว้นระยะ 5–30 วินาทีขณะ foreground service ยังทำงานและมี critical ค้าง; หากได้ focus กลับจึงลองเล่นต่อ หาก service หยุดแบบที่ `onDestroy` ถูกเรียกจะแสดง failure notification และคงเหตุการณ์ไว้ให้เปิดแอปกดเริ่มใหม่ แต่ process kill/force-stop อาจไม่เรียก `onDestroy` หรือแสดง notification ใหม่ ไม่เริ่ม foreground service เองหลัง process ถูกฆ่า, reboot หรือ force-stop และ **ไม่รับประกันว่าเสียงดังทุกสถานะ Android** ต้องตรวจจริงบน Pixel ก่อนใช้เป็นช่องทางปลุกหลัก

## Build บน Windows

ต้องมี JDK ที่เหมาะสม (ใช้ Android Studio JBR 21 ได้), Android SDK platform 36, build tools, network สำหรับ Gradle dependencies และ PowerShell

```powershell
Set-Location D:\works\notify-android
.\scripts\build-android.ps1 -WithTests
```

สคริปต์ใช้ Android Studio JBR และ `%LOCALAPPDATA%\Android\Sdk` หากไม่ได้ตั้ง `JAVA_HOME` / `ANDROID_HOME` ไว้ ผลลัพธ์: `artifacts\notify-alarm-poc-debug.apk` เป็น **debug-signed APK** ไม่ใช่ release signing สำหรับแจก production อย่าเปลี่ยนไปใช้ release key โดยไม่วางแผนการอัปเดตแอป

สคริปต์กำหนด locale en/US เฉพาะ JVM ของการ build เพื่อไม่ให้ Calendar แบบพุทธศักราชบน Windows ภาษาไทยสร้าง ZIP timestamp เกินช่วงที่รองรับ และคืน `JAVA_OPTS` เดิมหลังจบ ไม่เปลี่ยน locale ของ Windows

รุ่นที่แก้การหยุดเสียงโดย remote terminal คือ **0.6.0-safety-poc / versionCode 6**: debug APK แยกไฟล์อยู่ที่ `artifacts/notify-alarm-0.6.0-safety-debug.apk` ตรวจ package/signature ตรงกับ 0.5.0 เดิมแล้ว ติดตั้งทับด้วย `adb install -r` หลังผู้ใช้ยินยอม ไม่ถอนติดตั้งและไม่ล้างข้อมูล ขณะนี้ผ่าน build/JVM tests 14 เคส/lint ในเครื่อง แต่ยังไม่ติดตั้งหรือทดสอบ audio focus/FCM บน Pixel จริง

`-WithTests` รวม build test APK, JVM tests และ Android lint แต่ไม่ได้รัน instrumentation บนมือถือโดยอัตโนมัติ

## ติดตั้งและตั้ง Pixel

โหลด APK จากมือถือผ่าน [Node APK-only server](apk-download-th.md) ได้ ไม่ต้องติดตั้ง Backend ก่อน

1. โอน APK ไปเครื่องและอนุญาต Install unknown apps ให้แอปที่ใช้เปิดไฟล์เฉพาะเท่าที่จำเป็น หรือใช้ ADB หลังผู้ใช้เปิด USB debugging และอนุญาตคอมพิวเตอร์
2. เปิด Notify Alarm PoC อนุญาต notification และตรวจ channel ไม่ถูกปิด
3. ตั้ง App battery usage เป็นไม่จำกัดตามตัวเลือก Android รุ่นนั้น หน้าตรวจ battery exemption เป็นเพียงข้อมูล ไม่ใช่หลักฐานว่าตั้งทุกข้อครบแล้ว
4. ตั้งระดับ **เสียงปลุก** ที่ได้ยินจริง เปิดให้ alarms ผ่าน Do Not Disturb หากใช้ แอปไม่เร่งเสียงหรือเปลี่ยน DND ให้เอง
5. กดทดสอบเสียง ยืนยัน แล้วลองล็อกจอ เสียงต้องวน กดรับทราบจาก notification หรือเปิดแอปเพื่อหยุด
6. ทดลองอีกรอบโดยทิ้งเครื่องไว้ และทดสอบตอนเสียบ/ไม่เสียบชาร์จ ห้ามพึ่งผล emulator เป็นหลักประกันว่า Pixel ปลุกได้จริง

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb devices -l
# ระบุ serial ของ Pixel จริงเพื่อไม่ติดตั้งผิดเครื่อง
& $adb -s <PIXEL_SERIAL> install -r .\artifacts\notify-alarm-0.6.0-safety-debug.apk
```

ไม่ต้อง root, ไม่ขอ Accessibility, ไม่ปิด Play Protect แอปใช้ notification, foreground media playback, wake lock ระหว่างเล่น และ network

## เตรียม FCM ภายหลัง

อ่าน [คู่มือ Firebase แบบละเอียด](firebase-setup-th.md) สำหรับขั้นตอนในบัญชี Google, role ฝั่ง server และการเก็บ config/private key ให้แยกกัน

1. สร้าง Firebase project และ Android app ชื่อ package `dev.notifyalarm` แล้วดาวน์โหลด `google-services.json`
2. เก็บไฟล์ไว้นอก repository แล้วสร้าง resource แบบ local:

```powershell
.\scripts\configure-firebase.ps1 -GoogleServicesJson 'D:\private\google-services.json'
.\scripts\build-android.ps1
```

3. ติดตั้ง APK ที่ build ใหม่ เปิดแอป แล้วกดตรวจ Firebase/คัดลอก token การได้ token ไม่ใช่ผลทดสอบรับ push
4. ใช้ API bridge ใน `server` ตาม README ของส่วนนั้น ต้องมี service account ที่มีสิทธิ์ส่ง FCM เก็บเฉพาะฝั่ง server ห้ามฝัง private key ใน APK
5. ข้อความ remote ใช้ data fields `type=alert`, `alert_id`, `title`, `message`, `expires_at` แบบ UTC ISO8601; `alert_id` ต้องใหม่ต่อ incident แต่คงเดิมเมื่อ retry incident เดิม

Client configuration ไม่ใช่ service-account key และใช้แทนการอนุญาตส่งข้อความไม่ได้ แต่ก็ควรจำกัด API key ตาม Firebase guidance ไฟล์ resource ที่สคริปต์สร้างถูก ignore และไม่พิมพ์ config/token ลง console

Backend bridge เป็น PoC แบบเครื่องเดียว ยังไม่ใช่ API เต็มตามเอกสารสถาปัตยกรรม รุ่น 0.4 เพิ่ม [Ack sync ผ่าน HTTPS และ WorkManager](ack-sync-th.md) สำหรับข้อความใหม่ที่มี capability แต่ยังไม่มี business retries/escalation จึงยังไม่อ้าง end-to-end production readiness

## วิธีทดสอบอัตโนมัติ

Test APK มี custom instrumentation สำหรับ local engine เท่านั้น ต้องติดตั้งบน emulator ที่เตรียมไว้เฉพาะทดสอบ ไม่รันบนมือถือจริงของผู้ใช้โดยไม่แจ้ง เพราะจะเปิดเสียง:

```powershell
& $adb -s emulator-5580 install -r .\app\build\outputs\apk\debug\app-debug.apk
& $adb -s emulator-5580 install -r .\app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
& $adb -s emulator-5580 shell pm grant dev.notifyalarm android.permission.POST_NOTIFICATIONS
& $adb -s emulator-5580 shell am instrument -w dev.notifyalarm.test/dev.notifyalarm.AlarmInstrumentation
```

หรือใช้ `.\scripts\test-emulator.ps1` ซึ่งอนุญาตเฉพาะ serial `emulator-*` เก็บผล instrumentation และ screenshot/UI hierarchy ใน `artifacts/` หลังทดสอบ

ชุดทดสอบตรวจ expired-before-start, trigger/MediaPlayer playback state, fallback เมื่อเสียงระบบไม่มี, ยืนยันจอดับจริงและเล่นข้าม delivery expiry, dedupe, หลาย incident, notification PendingIntent Ack, pending offline Ack และ replay หลัง Ack ต้อง cleanup เสียงและคืนค่า ringtone หลังจบ ไม่มี exported debug receiver ใน APK หลัก Test runner จำกัด emulator เพิ่มอีกชั้น ไม่ใช้แทนการทดสอบเสียงด้วยคนบน Pixel

## สิ่งที่ยังต้องพิสูจน์

- รับ FCM จาก project จริงขณะล็อกจอ/Doze และเมื่อ foreground service เริ่มไม่ได้
- เสียง/ระดับเสียงจริงบน Pixel, DND และ battery settings
- การรับทราบจาก notification และการเล่นต่อเนื่องยาวกว่าการ smoke test
- Offline action sync, server receipt, retry, pairing/auth และความปลอดภัยก่อนเปิด API ออกอินเทอร์เน็ต
- การอัปเดต APK ด้วย signing key เดิมและการรักษา state

ดูผลทดสอบและข้อจำกัดที่ตรวจได้จริงในบันทึก validation แยกต่างหากเมื่อ build และ smoke test เสร็จ ไม่ถือว่ารายการข้างบนผ่านแล้วเพียงเพราะมีโค้ด
