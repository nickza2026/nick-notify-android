# Notify Alarm — Android PoC

## Go + PostgreSQL history dashboard (local milestone)

- [เปิด dashboard กับ PostgreSQL และอธิบายประวัติ/จำนวน Ack](docs/dashboard-local-th.md)
- [ตั้งค่า Dashboard login ผู้ดูแลหนึ่งบัญชีและ private bootstrap](docs/dashboard-runtime-th.md)
- [Frontend contract: login, บังคับเปลี่ยนรหัส, ประวัติ และส่งทดสอบ](docs/fe-dashboard-auth-th.md)
- [API สำหรับ service อื่นส่งแจ้งเตือน](docs/service-integration-th.md)
- [ระดับ normal เงียบ / critical ปลุก และการตรวจรับบน Pixel](docs/notification-importance-th.md)
- [Build backoffice ด้วย Docker / GitHub Actions](docs/backoffice-build-th.md)
- [API + Web: main → GHCR → Nortezh และสิ่งที่ผู้ดูแลต้องเตรียม](docs/nortezh-go-delivery-th.md)
- `backend/`: Go API + PostgreSQL ที่ผู้ใช้จัดหา; local integration tests ใช้ embedded PostgreSQL จริงและไม่ส่ง FCM จริง
- `dashboard/`: Next.js ภาษาไทยแบบ login ผู้ดูแลหนึ่งบัญชี เปลี่ยนรหัสครั้งแรก ดูประวัติ/Ack และส่งทดสอบ normal/critical เวลา Asia/Bangkok; API key อยู่ฝั่ง server เท่านั้น
- Go runtime production ใช้ `DATABASE_URL` ของ PostgreSQL ภายนอกและรัน SQL auto-migrate ก่อนเปิด API; ไม่ใช้ embedded demo เป็น production ไม่เชื่อมฐานข้อมูลจริง/deploy เองก่อนผู้ใช้ตั้งค่าและอนุมัติ
- Node `server/` และ Docker/K8s เดิมยังเก็บเป็น baseline ไม่ย้ายข้อมูลย้อนหลัง/ไม่หยุดบริการเดิมเอง; `.github/workflows/api-production.yaml` และ `web-production.yaml` เป็น standalone workflow ตาม Nick Skills `4a70d2f` แต่ละไฟล์มีสอง jobs เท่านั้น: `dockerize_n_push → deploy` ไม่มี reusable/caller หรือ staging; tests อยู่ใน job แรกก่อน login/build-push **เฉพาะ push `main` จึง push GHCR และ deploy** ส่วน manual branch run build/load เท่านั้น ไม่ publish/deploy และไม่รัน PR ตามนโยบายเดิม Build-push โหลด output เดียวกับที่ push; smoke ตรวจหลัง push ดังนั้น image อาจอยู่ใน GHCR แล้วแม้ smoke ทำให้ deploy ถูกบล็อก ดู [target/secrets/runtime/ingress prerequisites](docs/nortezh-go-delivery-th.md) ก่อนใช้งานจริง
- GitHub Actions Android เป็น **manual-only (`workflow_dispatch`)** ไม่มี compile/test อัตโนมัติบน push `main`; APK ติดตั้งทับ Pixel ได้เมื่อผู้ใช้ตั้ง Firebase client และ signing keystore เป็น repo Secrets แล้วกด manual run บน `main`: [คู่มือ GitHub APK](docs/github-apk-build-th.md) ไม่มี binary/secret ใน Git history
- ข้อมูลสาธิตต้องมีแถบ “ไม่ใช่ประวัติการส่งจริง” เสมอ และ provider acceptance ไม่ใช่หลักฐานว่าเครื่องได้รับ/ส่งเสียง
- Firestore เปลี่ยนเป็น baseline รุ่นก่อน ไม่ใช่ runtime ปัจจุบัน เก็บ source backup แยกและไม่ย้ายข้อมูลจริงอัตโนมัติ

Android native PoC สำหรับ Pixel 6 Pro: ทดสอบเสียงปลุกวนจนกดรับทราบทั้งหมด โดยเตรียม FCM receiver และ API bridge สำหรับต่อ server ภายหลัง ส่วน Flutter/iOS ยังไม่ได้สร้าง

- [วิธี build ติดตั้ง ทดสอบ และข้อจำกัด PoC](docs/android-poc-th.md)
- [Node server สำหรับให้มือถือดาวน์โหลด APK ผ่าน LAN](docs/apk-download-th.md)
- [ตั้ง Firebase ทีละขั้นและไฟล์ที่ผู้ใช้ต้องเตรียม](docs/firebase-setup-th.md)
- [Ack sync: สิทธิ์เฉพาะเหตุการณ์ คิว offline และ HTTPS URL](docs/ack-sync-th.md)
- [ผลสำรวจเครื่องมือ สถาปัตยกรรม API และแผน PoC (ภาษาไทย)](docs/remote-alert-system-th.md)
- [บันทึกตรวจทานโดย subagent และการแก้ไข](docs/review-remote-alert-system-th.md)
- [ผล validation ของ PoC](docs/validation-android-poc-th.md)
- [API bridge แบบ self-hosted](server/README.md)
- [Docker / Kubernetes: build, Secrets, PVC และข้อจำกัด](docs/deployment-k8s-th.md)

เอกสารสถาปัตยกรรมเป็นเป้าหมายระยะถัดไป ไม่ใช่รายการฟีเจอร์ที่ทำครบแล้ว ต้องแยกผลทดสอบ local alarm ออกจาก end-to-end push และการใช้งานจริงบน Pixel
