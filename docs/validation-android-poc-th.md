# บันทึก validation — Android PoC

วันที่: 19 ตุลาคม 2026

## Ack 0.4 milestone (17:07–17:27)

- ผู้ใช้ยืนยันเวลา 17:07 ว่า Pixel ดังจาก remote แล้ว เป็นผล user-reported Node→FCM→Pixel success ไม่ใช่ phone Ack→server success
- APK `0.4.0-ack-poc` versionCode 4 เพิ่ม WorkManager outbox, HTTPS per-alert capability, local action timestamp/UUID, retry/backoff และ periodic crash reconciliation แยกจาก local stop
- `scripts/build-android.ps1 -WithTests` ผ่าน: 4 JVM tests (PCM 1 + Ack policy 3), main/test APK และ lint 0 errors; ตรวจลายเซ็นผ่าน SHA-256 `7417CD87746F5D262B04327BC860D8260375926126CEC9181FEE03BE676A776A`
- Headless Android 16/API 36 instrumentation ผ่าน: sound choice persistence/default/builtin, missing system ringtone fallback, expired-before-start, playback state และจอดับข้าม expiry, dedupe, หลาย incident, notification Ack หยุดในเครื่อง และคงคิวเมื่อ endpoint เป็น synthetic HTTPS loopback ที่ติดต่อไม่ได้ พร้อมตรวจ periodic work ถูก persist ก่อนรับ route และ Ack-all ใช้ action UUID เดียวกันข้ามสอง incident
- Screenshot Ack panel จริง: pending=1, confirmed=0 ไม่อ้าง success เมื่อ endpoint ติดต่อไม่ได้ หลักฐาน `artifacts/emulator-ack-panel.png`/XML และ `artifacts/instrumentation.txt`; ปิด emulator ที่เราเปิดหลังทดสอบ ไม่ได้ใช้มือถือเป็น automated test target
- Node backend tests 25/25 ผ่าน รวม authorization/binding/replay/restart/TTL, capability ไม่รั่ว, disk failure, reservation failure ไม่ brick restart, GET ระหว่าง persist ที่ล้มเหลวไม่แสดง acknowledged และ invalid traffic ไม่กิน authenticated quota; Kustomize render ผ่านแต่ยังไม่ deploy
- Independent static review พบ 3 medium issues (crash/enqueue gap, tentative GET, quota exhaustion) แล้วตรวจซ้ำยืนยันแก้แล้ว ไม่ใช่ independent runtime rerun
- ยังไม่มี public HTTPS URL จึงไม่อ้าง Pixel Ack→server ผ่าน; live bridge เก่าที่ localhost:8789 ยังไม่ถูกเปลี่ยนไปเปิด public Ack และไม่ยิง FCM ซ้ำระหว่างทำงานนี้
- งานถัดไปที่ผู้ใช้อนุมัติ: Go backend/PostgreSQL + embedded integration tests และ Next.js dashboard ในเครื่อง งาน Node เป็น baseline ก่อนย้าย ไม่ใช่ production architecture สุดท้าย

## Remote FCM smoke test (16:56)

- รับไฟล์ token และ service-account JSON ที่ผู้ใช้จัดเตรียม ตรวจ service-account schema/Project ให้ตรง client config และเก็บสำเนาในโฟลเดอร์ส่วนตัวที่จำกัดสิทธิ์ ไม่แสดง key/token หรือบันทึกไว้ในเอกสารนี้ ต้นฉบับที่ root มี ignore rules
- พอร์ต 8787 มีโปรแกรมอื่นใช้อยู่ จึงไม่หยุด/แก้โปรแกรมนั้น เปิด Node PoC bridge แยกที่ `127.0.0.1:8789` และใช้ idempotency state ในโฟลเดอร์ส่วนตัว ไม่แชร์ไฟล์กับ process เดิม
- ส่ง synthetic high-priority data alert **หนึ่งครั้ง** หลังแจ้งเตือนผู้ใช้ว่าจะมีเสียงวน API ได้ `202 provider_accepted`; OAuth/FCM รับคำขอได้จริง แต่ยังไม่ยืนยัน received/alarm_started/การได้ยินบน Pixel
- Incident: `pixel-remote-test-f8ebb8c8a3a74a498fc36e67fed446bb`; latest-start expiry `2026-10-19T10:01:01.278Z` ไม่ใช่เวลาหยุดเสียงหลังเริ่ม
- ไม่ส่งซ้ำอัตโนมัติ เก็บ original request ส่วนตัวเพื่อรักษา idempotency รอผู้ใช้ยืนยันว่า Pixel ดังและกดรับทราบหยุดได้
- Node PoC bridge นี้ยังไม่มี Ack sync ดังนั้นเสียงหยุดบนมือถือไม่ทำให้ server ยืนยัน acknowledged โดยอัตโนมัติ

## รอบ Firebase 0.3.0 (16:38 เป็นต้นไป)

- Client config จาก `google-services.json` ที่ผู้ใช้วางไว้ root ผ่าน validation และสร้าง Firebase resources แล้ว ต้นทางและ generated resource ถูก ignore ไม่แสดงค่าใน log/เอกสาร
- รุ่น `0.3.0-firebase-poc`, versionCode 3: `scripts/build-android.ps1 -WithTests` ผ่าน JVM test, main/test APK และ lint หลังระบุ `-Xms64m` ลดการ commit heap แรกเริ่ม ไม่มีการเปลี่ยน pagefile หรือปิดแอปอื่น
- ตรวจ `apksigner verify` ผ่าน และตรวจ APK resource table เทียบกับค่าจาก XML จริงครบโดยประมวลผลภายใน ไม่แสดง config ออกมา
- ตรวจไฟล์จาก Node download server ที่เปิดจริง hash ตรง: `9244FB6252BFC4D35FB3C719D1AAC8E5055E3E70B58CC24B0D40D529D856D287`
- ยังไม่ได้ยืนยัน install/token registration บน Pixel, OAuth/IAM ฝั่ง server หรือ FCM delivery/เสียงจาก remote เหล่านี้ต้องใช้ Pixel และ server credentials เพิ่ม ไม่ถือว่า build/config ที่ผ่านเท่ากับส่งถึงแล้ว
- Node download server เป็น APK snapshot เท่านั้น ไม่เสิร์ฟไฟล์ JSON/source หรือเปิด notification API ออก LAN

## รอบอัปเดต 0.2.0 — เลือกเสียงและเตรียม Firebase (15:02 เป็นต้นไป)

- ผู้ใช้รายงานว่า APK รุ่นก่อนส่งเสียงบน Pixel 6 Pro ปกติ เป็นผลทดสอบจากผู้ใช้ ไม่ใช่การยืนยัน FCM/Doze/เสียงใหม่ทุกชนิด
- เพิ่ม sound preferences สำหรับ system alarm picker, app fallback และนำเข้า audio document สูงสุด 20 MiB ลง app-private storage ตรวจ duration/audio track; เปลี่ยนแล้วใช้ครั้งถัดไป
- `scripts/build-android.ps1 -WithTests` ผ่านหลังลด Gradle heap เป็น 768 MiB, workers=1 และไม่เก็บ daemon ข้ามรอบ เพื่อแก้ Windows commit-memory exhaustion โดยไม่เปลี่ยน pagefile/ปิดแอปอื่น
- APK 0.2.0 versionCode 2 ตรวจลายเซ็นผ่าน; SHA-256 `EEF582CDF8F3411259291CA2366E370BEBB8BC97DA99DC3BF089AE256CC0E889`
- Test APK ที่เพิ่ม sound selection persistence/default/builtin compile ผ่าน แต่ **ยังไม่ได้รัน instrumentation รอบ 0.2.0**: ไม่มี Android เชื่อมต่อ และ Windows free commit ประมาณ 2.3 GiB ไม่เหมาะเปิด emulator เพิ่มอย่างปลอดภัย ไม่ใช้ผล instrumentation รุ่น 0.1 แทนการทดสอบ feature ใหม่
- JVM PCM test/lint ผ่าน; ตัวเลือก system picker และนำเข้าไฟล์จริงบน Pixel ยังต้องตรวจเพิ่มเติม
- Node APK-only server isolation test ผ่าน 1/1 และตรวจ download จาก server ที่เปิดจริงได้ไฟล์ hash ตรง พร้อมตรวจ `/.env` คืน 404
- Firebase configuration script ผ่าน 13 synthetic tests; validation ล้มเหลวไม่เขียนทับ output เดิม/ไม่เปิดเผย config ไม่มีการเขียน Firebase resource จริง และยังไม่มี Firebase project/token/service-account ของผู้ใช้

## ผลรอบ 0.1.0 (ประวัติ ไม่ใช่ผลของฟีเจอร์เสียงใหม่)

## ผลที่ยืนยันแล้ว

- Backend bridge: `npm test` ใน `server/` ผ่าน 18/18 tests ในรอบตรวจซ้ำโดยผู้เขียน ครอบคลุม auth, validation, idempotency, provider failures, JWT และ FCM request ด้วย fake provider
- ไม่ได้ใช้ service-account จริงหรือส่ง FCM จริงในการทดสอบ Backend
- สร้าง debug APK ติดตั้งและเปิด `dev.notifyalarm/.MainActivity` บน headless Android 16/API 36 emulator สำเร็จ ตรวจ screenshot และ UI hierarchy ว่า render หน้าจอภาษาไทยจริงแล้ว หลักฐานอยู่ใน `artifacts/emulator-screen.png` และ `artifacts/emulator-ui.xml` (gitignored)
- พบ build issue จาก JVM locale ไทยทำ Calendar ใช้ปี พ.ศ. ซึ่งเกิน ZIP DOS date range แก้โดยกำหนด locale เฉพาะ Gradle JVM/สคริปต์ build เป็น en/US ไม่เปลี่ยน Windows locale
- Android build รอบล่าสุด: `scripts/build-android.ps1 -WithTests` ผ่าน ทั้ง main/test APK, JVM test ของ PCM fallback tone และ Android lint (มี warnings ไม่มี errors) ลด test-worker heap เป็น 128 MiB หลังค่าเริ่มต้น 512 MiB ชน Windows commit/pagefile limit โดยไม่แก้ pagefile ของระบบ
- รายงาน JVM: 1 test, 0 failures/errors; Android lint: 0 errors และ 22 warnings/information issues รวมข้อแนะนำ SDK/dependency versions และ false-positive `ImplicitSamInstance` ที่ `stopService(Intent)` จึงยังไม่เรียกว่า warning-free
- `apksigner verify --verbose` ผ่านด้วย APK Signature Scheme v2 (debug signing)
- Instrumentation รอบหลังแก้ผ่านบน emulator Android 16/API 36: expired-before-start ถูกปฏิเสธ, default ringtone ที่ตั้งใจชี้ไฟล์ไม่มีใช้ fallback ได้, MediaPlayer ยืนยันเริ่มเล่น, ยืนยันหน้าจอดับด้วย PowerManager และสถานะเล่นยังอยู่หลัง delivery expiry, dedupe, หลาย incident, ปุ่ม PendingIntent ของ notification ทำ offline Ack และ replay หลัง Ack ไม่เปิดเสียงใหม่ มี cleanup/คืนค่า system ringtone หลังทดสอบ
- หลักฐานผลเครื่องจำลอง: `artifacts/instrumentation.txt`, `artifacts/emulator-screen.png`, `artifacts/emulator-ui.xml` ขอบเขตเป็น smoke test ระยะสั้น ไม่ใช่ soak test หลายชั่วโมงหรือหลักฐานว่าได้ยินเสียงจริง
- APK ส่งทดสอบ: `artifacts/notify-alarm-poc-debug.apk`; SHA-256 `A0A702E1ED8451FD0B145958E968DAE0BC4DA20E5753F42203D91F6668CDE84F`
- Docker/Kubernetes: `kubectl kustomize deploy/k8s` render สำเร็จ ตรวจ static assertions เรื่อง single writer, Recreate, PVC, non-root, read-only filesystem และ Secret references ผ่าน ไม่ได้ deploy cluster
- Subagent ตรวจ source native แบบ read-only แล้ว ไม่พบ blocking defect ใน local path แต่แนะนำเพิ่ม channel readiness check และเพิ่ม instrumentation เพื่อยืนยัน screen-off จริง, เล่นข้าม delivery expiry และกด PendingIntent ของ notification รายการเหล่านี้จะบันทึกผลหลังแก้/ทดสอบ ไม่ใช่ static review ที่เทียบเท่า runtime proof

## ขอบเขตที่ยังไม่ยืนยัน

- เสียงที่ผู้ใช้ได้ยินบน Pixel 6 Pro, DND, OEM/system battery behavior และการปลุกระยะยาว
- FCM จริงขณะล็อกจอ/Doze ยังต้องมี Firebase configuration และเครื่องที่ลง APK แล้ว
- App ↔ Backend Ack sync ยังไม่ได้ทำ มีเพียง durable pending Ack ในเครื่อง
- Instrumentation รอบแรกพบ system ringtone URI ของ emulator ชี้ไปไฟล์ที่ไม่มีอยู่ แก้ด้วย app-owned PCM fallback แล้วรันทดสอบซ้ำผ่านดังข้างต้น เก็บข้อพบไว้เพื่อไม่ซ่อนสาเหตุล้มเหลวแรก
- Docker CLI มีอยู่แต่ Docker Desktop Linux engine ไม่ได้เปิด จึงยังไม่ได้ build/run container หรือทดสอบ SIGTERM บน Linux; เพิ่ม graceful shutdown handler ใน server แล้วแต่ยังไม่อ้างผล rollout จริง

การทดสอบ emulator ใช้แบบไม่มีหน้าต่างและปิดเสียง host เพื่อไม่รบกวนผู้ใช้ จึงต้องแยก MediaPlayer state/การ render ออกจากการยืนยันว่าได้ยินเสียงจริง
