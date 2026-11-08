# Shared-account devices — บันทึกตรวจสอบในเครื่อง

วันที่ 8 พฤศจิกายน 2026; branch `feat/shared-account-devices` ใน primary checkout งานฟีเจอร์ยังไม่ commit/push และไม่ได้ deploy/เปิดฐานภายนอก/ส่ง FCM จริง

สัญญาสำหรับผู้พัฒนา client อยู่ที่ [FE/Android handoff](fe-shared-devices-th.md); ขั้นตอนเตรียมระบบอยู่ใน [runtime guide](dashboard-runtime-th.md); [DBML](dashboard-auth.dbml) แก้ไขเพื่อทีม review ได้ ยังไม่ใช่การรับรอง schema/หน้าจอจากคนหรือ migration production

## ขอบเขตที่ตรวจแล้ว

- เจ้าของบัญชีเดียว login ได้หลาย installation; client bearer ไม่ใช้แทน application API key
- หนึ่ง alert กระจายไปยังสมาชิกที่เลือกตอนสร้าง; แยก capability และผลรับทราบรายเครื่อง
- กด Ack-all ครั้งเดียวใช้ action UUID เดียวข้ามหลาย alert ได้; retry ไม่เพิ่มจำนวน และ UUID ตรงกันคนละเครื่องไม่กลืนกัน
- ปลายทางเดิมถูกนำเข้าทะเบียนเมื่อเริ่มใช้งาน ไม่หายเพราะเครื่องใหม่ลงทะเบียนก่อน; token เดิมรับเป็นทะเบียนเดิมได้ ไม่เพิ่มผู้รับซ้ำ
- ยกเลิกเครื่องสุดท้ายแล้วไม่กลับไปส่ง static target ที่ยกเลิก; migration/restart ไม่คืนทะเบียนนั้น
- การขาด config ที่จำเป็นไม่เปิดทะเบียนจนเส้นทางเดิมเสีย การเปลี่ยน application key ไม่เปลี่ยน encryption key ของทะเบียน
- token refresh/revoke/stale `UNREGISTERED` ไม่ทำให้ token ใหม่ถูกลบโดยผลตอบกลับเก่า
- Native login/password/logout-recovery ใช้ลำดับ network แยกจาก state lock; status/local Ack ไม่รอ HTTP และ response เก่าไม่ทับ credential รุ่นใหม่
- Logout ต้องได้รับ `200` และ `logged_out:true`; offline/401 คง pending เพื่อจบการยกเลิกอย่างชัดเจน
- ตั้งค่า exclude credential/installation จาก backup/transfer domains และตรวจ XML/rules แล้ว; ยังไม่ได้ทดสอบการย้ายเครื่องจริง

## คำสั่งที่รันจริง

### Backend + embedded PostgreSQL

```text
cd backend
go test -p 4 ./... -count=1 -timeout=8m
```

ผ่าน package backend ประมาณ 247 วินาที ใช้ PostgreSQL ที่สร้างเองเฉพาะ loopback และเก็บข้อมูล UTF-8 ไม่ใช่ `DATABASE_URL` จริง cleanup เป็นส่วนหนึ่งของ test process คำสั่ง `cmd/dev` และ `cmd/notify-api` ไม่มี test cases แยก ไม่ได้นับว่าได้ทดสอบ deployment

Regression `TestDeviceAckAllActionAcrossAlerts` เคย fail ด้วย HTTP 409 เมื่อ action เดียวไป alert ที่สอง แล้วจึงแก้และผ่านใน full suite นี้

### Android

```text
gradlew.bat :app:testDebugUnitTest :app:assembleDebug --offline --rerun-tasks
```

ใช้ SDK ที่เอกสารโครงการระบุผ่าน environment เฉพาะ process; `compileSdk=36`, `targetSdk=35` ไม่แก้ global Windows environment ผล parent-run: 41 Gradle tasks executed, JUnit **30 tests / 0 failures / 0 errors / 0 skipped** เป็น JVM/Robolectric และ build ไม่ใช่การติดตั้ง APK/เล่นเสียงบน Pixel

### Web

```text
cd dashboard
pnpm test
pnpm typecheck
pnpm build
```

ผ่าน **33 tests**, typecheck และ Next.js production build รวมหน้า `/devices` กับ BFF ที่เกี่ยวข้อง

### Rendered browser integration

```text
node tools/check-dashboard-browser.mjs
```

ผ่าน 10 กลุ่ม flow ใช้ Edge profile ใหม่, production standalone Web, Go API, PostgreSQL UTF-8 และ **synthetic sender** สร้าง client installation สองชุด ไม่ใช่ Android emulator สองเครื่องหรือมือถือจริง

- login/forced password change/secure cookie/host-origin guards
- normal/critical confirmation และ retry คำขอเดิมโดยไม่ส่งซ้ำ
- รับทราบรายเครื่อง, Ack-all ข้าม alert, per-device action identity
- token refresh, revoke cancel/confirm, native logout และ idempotent recipient snapshot
- dark/light/system, 1440/1024/390/360 และ 200%-equivalent reflow, table keyboard scroll, modal Escape/Cancel focus
- มีป้ายข้อมูลสังเคราะห์ ไม่อ้างว่าโทรศัพท์รับหรือส่งเสียง

หลักฐานรอบผ่าน: `artifacts/dashboard-auth-check/2026-11-08T12-02-49-103Z-aa5567e2/report.json` มี source/build fingerprint, screenshots, `passed:true`, `cleanup:true` โฟลเดอร์ทำงานชั่วคราว/process/ฐานที่สร้างเองถูกหยุดและลบหลังจบ เหลือเฉพาะหลักฐานขนาดเล็ก

Regression ของ screenshot acquisition ยังผ่าน: producer ล้มเหลวต้องไม่ยืม screenshot เก่ามาอ้างว่าสำเร็จ Browser harness รอ Ant popup animation/close และ viewport paint จริงก่อนวัด ไม่แก้ด้วยซ่อน overflow

## APK สำหรับตรวจต่อ

- `artifacts/notify-alarm-0.7.0-device-login-debug.apk`
- package `dev.notifyalarm`, versionCode `7`, versionName `0.7.0-device-login`
- SHA-256: `2c7a1017beb270d6b7024b8674a7b8b330a1bba02402de5e212c4e4c499eb68d`
- ตรวจ metadata/signature และ source freshness ของ APK ก่อนคัดลอก ไม่เขียนทับ artifact เดิมโดยเงียบ ๆ
- เป็น **Android Debug signer** ยังไม่ได้เปรียบเทียบกับ signer ของ APK ที่ติดตั้งจริง อย่าถอนติดตั้ง/reset เพื่อฝืน update ควรสร้างผ่าน signing workflow เดิมก่อนทดสอบบนโทรศัพท์เพื่อรักษาข้อมูลในเครื่อง
- receipt: `artifacts/notify-alarm-0.7.0-device-login-debug.receipt.json`

## ยังไม่ใช่สิ่งที่ตรวจแล้ว

ไม่มี production deployment/การ provision secrets/ฐานภายนอก/FCM acceptance จริง/การรับ push หรือเสียงบนสองมือถือ/Keystore บนอุปกรณ์จริง/การย้ายเครื่องจริง/Pixel → public HTTPS → Go/PostgreSQL Ack จริง การมี resource ของ Firebase ใน APK เพียงอย่างเดียวไม่พิสูจน์ว่า config ถูกต้องหรือส่งถึงโครงการที่ต้องการ

ขั้นต่อไปคือจัดเตรียม API HTTPS และ private configuration ตาม runtime guide สร้าง APK ด้วย signer เดิม แล้วขออนุมัติการทดสอบ remote จริงเป็นการแยกต่างหาก
