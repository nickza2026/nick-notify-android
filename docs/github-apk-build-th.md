# สร้าง Android APK ผ่าน GitHub Actions

ไฟล์ workflow คือ `.github/workflows/android-apk.yaml` บน `main` ใน `nickza2026/nick-notify-android` ใช้ **`workflow_dispatch` เท่านั้น (manual-only)** โดย **ไม่ commit APK หรือ Firebase/keystore ลง repository** และไม่ deploy/backend send ข้อความจริง Signed APK job ยังคงจำกัด `main`; manual บน branch อื่นไม่ทำให้ได้ signed artifact

## สองทางที่ไม่ควรสับสน

| Trigger | สิ่งที่ทำ | APK สำหรับ Pixel |
|---|---|---|
| Push / PR / tag | **ไม่เริ่ม Android workflow**; ไม่มี automatic compile/test/APK บน `main` | ไม่มี artifact จาก trigger เหล่านี้ |
| กด **Actions → Build Android Alarm APK → Run workflow** บน `main` | ตรวจ tests ก่อน แล้วใช้ Firebase client + signing key จาก GitHub Actions Secrets สร้าง APK 0.6 ตรวจ certificate/version และ upload artifact | ใช้อัปเดตแอปเดิมได้ **เฉพาะเมื่อ** signing key ตรงกับ APK เดิมและ Android ตรวจรับจริง; ไม่มีการติดตั้งลงมือถือโดย Actions |

งาน manual จะ **fail แบบไม่สร้าง APK artifact** หากยังไม่กำหนด Secrets หรือ signer ผิด โดยตรวจ fingerprint ของ keystore ที่ถอดจาก Secret **ก่อน build** และบังคับ Gradle ใช้ไฟล์นั้นผ่าน `NOTIFY_CI_DEBUG_KEYSTORE` แล้วตรวจลายเซ็น APK ซ้ำก่อน upload จึงไม่ fallback ไปใช้ debug key ที่ runner สร้างเองหรือ APK ที่ไม่มี FCM ห้ามแก้ workflow ให้ข้ามขั้นตรวจ signer เพื่อให้ CI ผ่าน

## ตั้งค่า Secrets ก่อนกด manual build

ผู้ใช้ตั้งเองใน GitHub repository → **Settings → Secrets and variables → Actions**; ห้ามส่งค่าในแชต, ใส่ source, commit หรือ GitHub issue:

1. `NOTIFY_FIREBASE_CLIENT_JSON_B64` = base64 ของ **Firebase Android client** `google-services.json` ที่มี package `dev.notifyalarm` เท่านั้น (ไม่ใช่ service-account JSON ของ backend)
2. `NOTIFY_ANDROID_DEBUG_KEYSTORE_B64` = base64 ของ **keystore ที่เซ็น APK 0.5/0.6 บน Pixel อยู่แล้ว** ไม่ใช่ debug keystore ที่ GitHub runner สร้างใหม่ ไม่ต้อง upload keystore ลง repo. Workflow ตรวจ SHA-256 ของ signing certificate กับ fingerprint สาธารณะ `79c26a1c9329aa69933eada6c5e13b7718d43ae1da90120de639fe23f10cc9d4` ก่อน upload

หากใช้ GitHub CLI ที่ **คุณล็อกอินและมีสิทธิ์ตั้ง repo secrets เองแล้ว** จะส่งจาก PowerShell stdin โดยไม่แสดง base64 ในคำสั่ง/แชต (แก้ path ของไฟล์ส่วนตัวเอง อย่ารันจาก directory ที่เผยแพร่):

```powershell
$repo = 'nickza2026/nick-notify-android'
$clientPath = 'D:\private\notify-alarm\google-services.json'
$keystorePath = 'D:\private\notify-alarm\existing-debug.keystore'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($clientPath)) | gh secret set NOTIFY_FIREBASE_CLIENT_JSON_B64 --repo $repo
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath)) | gh secret set NOTIFY_ANDROID_DEBUG_KEYSTORE_B64 --repo $repo
```

ตัวอย่าง path ไม่ใช่ค่า credential จริง ตรวจ `gh` exit code หลังแต่ละคำสั่งด้วยตนเอง หาก authentication/permission ล้มเหลว **หยุดและจัดการสิทธิ์ด้วยวิธีปกติของคุณเอง** ห้ามค้น key อื่นหรือ retry ด้วยวิธีเลี่ยงการป้องกัน. การนำ debug signing key เดิมไปไว้ใน GitHub Secrets เป็นการให้ runner เข้าถึง private signing material เพื่อให้ APK ติดตั้งทับได้; ถ้าไม่ยอมรับความเสี่ยงนี้ ให้ build Android APK บนเครื่องเดิมแทน

`google-services.json` เป็น client configuration ซึ่งจำเป็นต้องฝังข้อมูลแอป/Firebase API key ใน APK เพื่อรับ FCM และจึง **ไม่สามารถถือว่าซ่อนจากผู้ดาวน์โหลด APK ได้** แม้ต้นฉบับอยู่ใน GitHub Secret; ตั้ง restriction สำหรับ client key ใน Firebase/Google Cloud ตามคำแนะนำผู้ให้บริการ. **ห้าม** ใช้ service-account credential ใน APK หรือ workflow นี้

## วิธีดาวน์โหลดและตรวจ

หลัง manual workflow ผ่าน ให้เปิด run นั้น → **Artifacts** → `notify-alarm-0.6.0-safety-debug-<commit>` แตกไฟล์ zip แล้วได้ `notify-alarm-0.6.0-safety-debug.apk` ตรวจว่ามาจาก run บน `main` ที่คุณตั้งใจและ versionCode 6 ก่อนติดตั้งทับ (`adb install -r` หรือเปิด APK บน Pixel); **อย่าถอนแอป/ล้างข้อมูล** เพราะ pending Ack/tombstones อยู่ในเครื่อง Artifact หมดอายุใน 7 วัน ไม่ใช่ release/production signature

ผ่าน build/lint/JVM tests หรือ Actions artifact ไม่ได้ยืนยัน `Go → FCM → Pixel → เสียง → Ack ผ่าน HTTPS → PostgreSQL` และไม่ได้พิสูจน์ Doze/เสียงจริง ต้องทดสอบ synthetic incident บน Pixel ตาม [checklist normal/critical](notification-importance-th.md) เมื่อพร้อมให้เครื่องดัง โดยรักษา secrets/TLS/ฐานข้อมูลแยกไว้หลังบ้าน
