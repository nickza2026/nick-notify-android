# ตั้ง Firebase สำหรับ Notify Alarm บน Pixel 6 Pro

ตรวจเอกสารทางการ: 19 ตุลาคม 2026  
สถานะ: คู่มือเตรียมตั้งค่า **ยังไม่ได้สร้าง project, ดาวน์โหลด credential หรือยืนยัน push จริงของผู้ใช้**

เป้าหมายรอบนี้: `API bridge → FCM high-priority data → Pixel → เสียงวน → กดรับทราบในเครื่อง` ไม่ใช่การส่ง notification ธรรมดาจากหน้า Firebase Console แล้วถือว่าพิสูจน์ alarm engine แล้ว

## 1. สิ่งที่ต้องใช้และสิ่งที่ไม่ต้องทำ

ต้องมีบัญชี Google ที่สร้าง Firebase project ได้ อินเทอร์เน็ตบน Pixel และเครื่องที่ใช้ build/run server ผู้ใช้เป็นคนล็อกอินบัญชี Google เอง **ไม่ส่งรหัสผ่าน, session cookie, private key หรือเนื้อหา service-account JSON ในแชต**

- ใช้ Firebase Cloud Messaging (FCM) ซึ่งหน้าราคาทางการระบุว่า **No-cost** เริ่มด้วย Spark plan ได้ ไม่ต้องผูกบัตรเพื่อ FCM เอง ค่า server/เครือข่ายหรือ Google Cloud product อื่นเป็นคนละส่วน
- ไม่ต้องสร้าง Firestore, Realtime Database, Cloud Storage, Cloud Functions หรือ Authentication สำหรับ PoC นี้ Backend เก็บ idempotency ลงไฟล์อยู่แล้ว
- Google Analytics ไม่จำเป็นต่อเส้นทางรับ FCM ของ PoC นี้ จึงปิดตอนสร้าง project ได้ แต่ Firebase ระบุว่าการรายงาน message delivery ใน Analytics ต้องเปิด Analytics อย่าสับสนระหว่างไม่มีรายงานกับข้อความไม่ถึง
- **ไม่ต้องนำแอปขึ้น Google Play** เพื่อใช้ FCM บน Pixel ที่มีบริการ Google; เอกสารกำหนดเครื่อง Android ที่มี Google Play Store/Google Play services ที่รองรับ
- สำหรับ **FCM-only ตามคู่มือ Android ปัจจุบันไม่มีขั้นบังคับเพิ่ม SHA-1/SHA-256** หาก Console มีช่อง signing certificate ให้เว้นก่อน ไม่ใช้ข้อสรุปนี้กับ Google Sign-In, Phone Auth หรือฟีเจอร์อื่นซึ่งอาจต้องใช้ certificate
- APK package ของเราเป็น **`dev.notifyalarm`** ตัวพิมพ์ต้องตรง ไม่ใช่ชื่อที่แสดงบนหน้าจอ `Notify Alarm PoC`

## 2. ขั้นแรกที่ให้ผู้ใช้ทำตอนนี้: project และ client config

1. เปิด <https://console.firebase.google.com/> และล็อกอินบัญชีของคุณ
2. สร้าง project ใหม่ เช่นชื่อแสดงผล `Notify Alarm` เลือก Project ID ที่ต้องการ จด **Project ID** แยกจาก **Project number**; อย่าเลือก project production อื่นโดยเผลอ
3. ปิด Google Analytics ได้สำหรับ PoC นี้ แล้วสร้าง project รอจนเสร็จ
4. หน้า Project overview เลือกไอคอน Android หรือ **Add app → Android**
5. ช่อง Android package name ใส่ **`dev.notifyalarm`** ชื่อเล่นใส่ `Pixel Alarm` ได้ ส่วน SHA certificate เว้นก่อนสำหรับ FCM-only
6. กด Register app แล้วดาวน์โหลด **`google-services.json`**
7. เก็บไฟล์นอก repository เช่น **`D:\private\notify-alarm\google-services.json`** อย่าวางใน `artifacts/` หรือพื้นที่ที่ใช้แจกไฟล์ให้มือถือ
8. แจ้งเพียง **path ที่เก็บไฟล์** ให้ผู้ช่วยทำขั้นแปลง config/build ต่อ ไม่ต้อง paste เนื้อหา JSON ในแชต

Firebase ระบุว่า `google-services.json` มี project/app identifiers ที่ไม่ใช่ service-account private key แต่ยังควรจัดการอย่างระมัดระวังและจำกัด API key ตาม guidance ของ Firebase มัน **ใช้แทนสิทธิ์ส่ง FCM จาก server ไม่ได้** และควรเก็บแยกจาก service-account JSON เพื่อไม่สับสน

Package name เปลี่ยนย้อนหลังสำหรับ app registration เดิมไม่ได้ ถ้าใส่ผิดให้เพิ่ม Android app registration ที่ถูกต้อง ไม่เปลี่ยน application ID ใน APK ของเราเพื่อแก้ตามโดยพลการ

## 3. ส่วนที่ผู้ช่วยทำต่อได้เมื่อมี path ของ client config

```powershell
Set-Location D:\works\notify-android
.\scripts\configure-firebase.ps1 `
    -GoogleServicesJson 'D:\private\notify-alarm\google-services.json'
.\scripts\build-android.ps1 -WithTests
```

โปรเจกต์นี้ใช้สคริปต์แปลง config เป็น Android string resources ใน `app/src/main/res/values/firebase-local.xml` ที่ถูก gitignore อยู่แล้ว แทนการใช้ Google services Gradle plugin แปลงไฟล์อัตโนมัติ สคริปต์ตรวจ package, Android app ID, project number, project ID และ key format ก่อนเขียน ไม่พิมพ์ค่าออก console และไม่เขียนทับ config เดิมเมื่อ validation ไม่ผ่าน

สคริปต์มี `-OutputPath` สำหรับแยก output ใน tests เท่านั้น การตั้งค่าจริงให้ใช้ค่า default เพื่อให้ resource เข้า APK สคริปต์แปลง client config **ไม่รับ/ไม่ต้องการ service-account private key**

ติดตั้ง APK ใหม่ทับรุ่นเดิมบน Pixel โดยใช้ `dev.notifyalarm` และ debug signing key เดิมจากเครื่อง build เดิม ไม่ต้องถอนแอปก่อน เพื่อรักษาค่าที่บันทึกไว้ หากเจอ `INSTALL_FAILED_UPDATE_INCOMPATIBLE` ให้ตรวจ signing key ก่อน อย่าถอนแอป/ล้างข้อมูลโดยไม่แจ้ง เพราะจะเสีย local state และ token อาจเปลี่ยน

จากนั้นเปิดแอป กด **ตรวจการตั้งค่า Firebase / คัดลอก token**:

- ถ้ายังขึ้นไม่มี config ให้ตรวจว่าใช้ APK ที่ build หลังแปลง config แล้ว
- ถ้าขอ token ไม่สำเร็จ ให้ตรวจ network, Google Play services และ client config/API restrictions ไม่รับปากว่าเปิดแอปแล้วจะได้ token เสมอ
- token ที่คัดลอกเป็นข้อมูลอ่อนไหว อย่าวางใน screenshot/log/แชตสาธารณะ เก็บใน secret store หรือไฟล์ส่วนตัวสำหรับขั้น server
- การได้ token ยืนยันเพียงการลงทะเบียน FCM ไม่ใช่หลักฐานว่ารับ push แล้วหรือได้ยินเสียง
- token อาจ rotate ได้ เช่นหลัง reinstall/clear data ต้องอัปเดต server ปัจจุบันยังไม่มี registration/token sync อัตโนมัติ

## 4. เปิด API และเตรียม service account ฝั่ง server

ทำหลัง client registration ถูกต้องแล้ว โดยเลือก **Google Cloud/Firebase project เดียวกัน** กับไฟล์ client config:

1. Firebase Console → Project settings → Cloud Messaging ตรวจว่า **Firebase Cloud Messaging API (HTTP v1)** เปิดใช้งานแล้ว ถ้ายังไม่เปิด ใช้ลิงก์ Manage API หรือ Google Cloud Console → APIs & Services เปิด Firebase Cloud Messaging API ของ project นั้น
2. ไป Google Cloud Console → IAM & Admin → Service Accounts สร้างบัญชีเฉพาะ เช่น `notify-alarm-sender` ไม่ใช้ Owner/Editor เพื่อความสะดวก
3. ให้ role **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`) ใน project เป้าหมาย เอกสาร IAM ระบุว่ามี permission `cloudmessaging.messages.create` และเป็น role ที่เอกสาร FCM ใช้สำหรับอนุญาตส่งข้อความ
4. สำหรับ bridge ปัจจุบันที่รันเองนอก Google Cloud ต้องมี service-account JSON: Service account → Keys → Add key → Create new key → JSON จัดเก็บทันทีในพื้นที่ส่วนตัว เช่น **`D:\private\notify-alarm\service-account.json`**
5. จำกัด ACL ให้เฉพาะ account ที่รัน server/ผู้ดูแลอ่านได้ ไม่ commit, ไม่ส่งผ่าน Node download server และ **ห้ามใส่ใน APK**

ชื่อเมนู Console อาจเปลี่ยนได้ ให้ตรวจว่าเป็น **HTTP v1** ไม่ใช้ legacy server key หรือคู่มือที่ยังสั่งส่งด้วย legacy API

หากองค์กรปิดการสร้าง service-account keys **อย่าหาทางปิด policy เพื่อข้ามเอง** แจ้งข้อจำกัดก่อน แล้วปรับ bridge ไปใช้ ADC/Workload Identity ที่สภาพแวดล้อมรองรับ เอกสาร Google แนะนำแนวทางไม่ต้องมี key file เมื่อรันบน Google Cloud แต่ **bridge รุ่นนี้อ่าน service-account JSON และสร้าง OAuth JWT เอง ยังไม่ได้รองรับ Workload Identity/ADC อัตโนมัติ** แม้ชื่อตัวแปรจะเป็น `GOOGLE_APPLICATION_CREDENTIALS`

Server ขอ OAuth scope `https://www.googleapis.com/auth/firebase.messaging` แล้วส่งไป HTTP v1 ของ Project ID ที่อยู่ใน service-account JSON ไม่ต้องสร้าง OAuth client consent screen สำหรับ flow service-account นี้

## 5. ตั้งค่าและทดสอบ server แบบในเครื่องก่อน

เตรียมไฟล์ต่อไปนี้นอก repo โดยไม่พิมพ์ค่าลง console:

| ไฟล์ | เนื้อหาและที่มา |
|---|---|
| `google-services.json` | client config สำหรับ build APK เท่านั้น |
| `service-account.json` | private credential สำหรับ process ฝั่ง server เท่านั้น |
| `device-token.txt` | FCM token ที่คัดลอกจาก Pixel รุ่น APK ที่ตั้ง config แล้ว |
| `api-key.txt` | random API key อย่างน้อย 32 bytes ใช้ร่วมกันระหว่าง API bridge กับระบบที่ส่งเหตุการณ์ |

ใช้ key เดิมที่เก็บอย่างปลอดภัยเมื่อมี caller แล้ว ไม่สร้างใหม่ทุกครั้งที่เปิด shell ตัวอย่างต่อไปนี้ **อ่านไฟล์ที่เตรียมไว้แล้ว** ไม่พิมพ์ค่าลับ:

```powershell
Set-Location D:\works\notify-android
$Private = 'D:\private\notify-alarm'
$env:ALERT_API_KEY = ([IO.File]::ReadAllText((Join-Path $Private 'api-key.txt'))).Trim()
$env:FCM_DEVICE_TOKEN = ([IO.File]::ReadAllText((Join-Path $Private 'device-token.txt'))).Trim()
$env:GOOGLE_APPLICATION_CREDENTIALS = Join-Path $Private 'service-account.json'
# รัน loopback ก่อน ไม่เปิด port ออกอินเทอร์เน็ต
node .\server\index.mjs
```

ถ้ายังไม่มี API key ให้ผู้ช่วยสร้างด้วย cryptographic randomness แล้วบันทึกลงไฟล์ส่วนตัว/secret store โดยไม่แสดงในแชต ไม่ใช้ password ที่เดาง่าย ตัวแปร environment ของ caller ต้องตรงกับ process server; หากเรียกจากอีก PowerShell window ต้องอ่าน secret เดิมใน window นั้นด้วย ไม่ใช่สร้าง key ใหม่

ในอีก shell ตรวจ `http://127.0.0.1:8787/health` ก่อน `ready:true` หมายถึงโหลด **configuration** ได้ ไม่ได้ตรวจ OAuth/สิทธิ์ IAM/การถึงเครื่องจริง หากไม่มี config/token จะเป็น `ready:false` การอ้างว่า server พร้อมปลุกต้องทดสอบครบเส้นทางต่อไปนี้:

```powershell
# ใน shell ของ caller ที่โหลด ALERT_API_KEY เดียวกับ server แล้ว
$incident = 'pixel-test-' + [Guid]::NewGuid().ToString('N')
$headers = @{
    Authorization = "Bearer $env:ALERT_API_KEY"
    'Idempotency-Key' = $incident
}
$body = @{
    alert_id = $incident
    title = 'ทดสอบแจ้งเตือนตู้ดับ'
    message = 'นี่เป็นการทดสอบจาก server กรุณากดรับทราบบน Pixel'
    ttl_seconds = 300
} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/v1/alerts' `
    -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

รอบแรกเปิดแอปไว้แล้วทดสอบ จากนั้นทำ **incident ใหม่** ขณะล็อกจอ/แอป background และทดสอบ Doze แยกภายหลัง ไม่ใช้ ID ของเหตุการณ์ที่รับทราบไปแล้ว เพราะแอปกัน replay ด้วย tombstone ค่า `ttl_seconds` เป็นเส้นตายเริ่มปลุก ไม่ใช่เวลาที่เสียงต้องหยุด หลังเริ่มต้องกดรับทราบจึงหยุดตามพฤติกรรมที่ผู้ใช้ต้องการ

ถ้า retry **คำขอเดิม** จากความผิดพลาดของ network ให้ใช้ Idempotency-Key/body เดิม ไม่สร้าง incident ใหม่โดยเดาผล เพราะ provider อาจส่งถึงแล้ว ข้อผิดพลาด/ข้อจำกัด idempotency ดู [server README](../server/README.md)

## 6. หลักฐานที่จะถือว่าทดสอบผ่าน

| ขั้น | หลักฐาน | สิ่งที่ยังสรุปไม่ได้ |
|---|---|---|
| สร้าง resource/build/install | APK มี Firebase client config ของ project ที่เลือก | ยังไม่รู้ว่า token หรือ delivery ใช้งานได้ |
| กดขอ token สำเร็จ | ได้ token ของ installation ปัจจุบัน | ยังไม่ใช่ receive หรือ alarm_started |
| API ตอบ `202 provider_accepted` | FCM รับคำขอ | ยังไม่ใช่มือถือได้รับ/ได้ยิน |
| Pixel รับเหตุการณ์และเสียงวน | สังเกตที่เครื่องจริง พร้อมเวลาและสถานะ engine | ไม่รับประกันทุกสภาวะ OS/network |
| กดรับทราบแล้วหยุดแม้ออฟไลน์ | พฤติกรรม local Ack ผ่าน | ยังไม่ใช่ server confirmation ต้องรอ HTTP Ack/receipt ผ่านเส้นทาง HTTPS ในรุ่น 0.4 |

การส่งจาก Firebase Console มักเป็น notification message ซึ่งตอน background ระบบอาจแสดง tray แทนเรียก receiver จึงไม่เทียบเท่า **high-priority data message ผ่าน bridge** ของเรา ห้ามใช้ผล Console test อย่างเดียวรับรองเสียงวน/foreground-service path

รุ่น 0.4 เพิ่ม [Ack sync/receipt lookup](ack-sync-th.md) เมื่อมี HTTPS URL จริง แต่ยังไม่มี business retry scheduler, device-delivery receipt query, pairing/login, auto token registration หรือ escalation ดังนั้นยังไม่เปิดการส่งปลุกซ้ำอัตโนมัติ และไม่บอก server ว่ารับทราบแล้วเพียงเพราะเสียงหยุด ต้องได้รับ valid durable Ack ต่างหาก

## 7. Docker / Kubernetes หลังผ่าน local test

ใช้ [คู่มือ Docker/Kubernetes](deployment-k8s-th.md) เพื่อ mount service-account JSON แบบ read-only และเก็บ API key/device token ใน Kubernetes Secret ไม่ใส่ credential ใน image หรือไฟล์ YAML ที่ commit ปัจจุบันต้อง **1 replica + Recreate + PVC** เพราะ state เป็นไฟล์ ไม่ scale หลาย process และไม่ถือว่า readiness probe เป็นหลักฐาน FCM ถึง Pixel

## 8. แหล่งอ้างอิงทางการที่ตรวจผ่าน HTTP

1. Android registration/package/config — <https://firebase.google.com/docs/android/setup>
2. FCM Android client/Google Play/Analytics/token — <https://firebase.google.com/docs/cloud-messaging/android/client>
3. HTTP v1 authorization/service account/API enablement — <https://firebase.google.com/docs/cloud-messaging/auth-server>
4. ส่งข้อความ HTTP v1/OAuth scope — <https://firebase.google.com/docs/cloud-messaging/send/v1-api>
5. Firebase IAM predefined product roles — <https://firebase.google.com/docs/projects/iam/roles-predefined-product>
6. FCM pricing (No-cost) — <https://firebase.google.com/pricing>

หากยังไม่มี config ให้เริ่ม **สร้าง project → ลงทะเบียน `dev.notifyalarm` → ดาวน์โหลด `google-services.json` เก็บนอก repo แล้วแจ้ง path** ขั้น service account ทำต่อหลังตรวจ client config ถูกต้อง ไม่ต้องส่ง private key ในแชต

### สถานะรอบตั้งค่าจริง 19 ตุลาคม 2026

ผู้ใช้วาง `google-services.json` ที่ root ของโปรเจกต์แล้ว สคริปต์ตรวจ schema/package/sender ผ่านและสร้าง `app/src/main/res/values/firebase-local.xml` แล้ว โดยไฟล์ต้นทางที่ root และ resource ถูก ignore ไม่แสดงค่าข้างใน การมี resource ยังไม่เท่ากับ build/install/token/delivery ผ่าน ให้ติดตามผลใน [validation](validation-android-poc-th.md)
