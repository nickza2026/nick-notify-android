# Runtime ของ Dashboard แบบ Login — API / Web บน Nortezh

เอกสารสำหรับ feature branch ที่เพิ่ม login ผู้ดูแลหนึ่งบัญชี ไม่ใช่ผล rollout production และไม่ใช่ GitHub Actions environment secrets ข้อกำหนด wire สำหรับ browser อยู่ใน [FE handoff](fe-dashboard-auth-th.md)

## API — notify-alarm-api

```dotenv
HOST=0.0.0.0
PORT=8787
DATABASE_URL=postgresql://<USER>:<PASSWORD>@<DB_HOST>:5432/<DB_NAME>?sslmode=verify-full&connect_timeout=10
ALERT_API_KEY=<server-application-key-at-least-32-bytes>
GOOGLE_APPLICATION_CREDENTIALS=/secrets/firebase-service-account.json
FCM_DEVICE_TOKEN=<device-registration-token>
ACK_PUBLIC_BASE_URL=https://<public-api-domain>
DASHBOARD_ADMIN_USERNAME=admin
DASHBOARD_BOOTSTRAP_PASSWORD=<private-random-initial-password-at-least-32-bytes>
```

- ทุก `<...>` เป็น placeholder ห้ามใช้เป็น credential จริง ไม่ส่งค่าจริงในแชต/source/log
- `DATABASE_URL` เป็น connection string ไม่ใช่พาธไฟล์ ฐานต้อง UTF-8 และตั้ง TLS/CA ตามผู้ให้บริการ API อาจทำ migration เมื่อเริ่ม ต้องตรวจสิทธิ์/backup/compatibility ของฐานจริงก่อน rollout แยก ไม่ใช้ embedded PostgreSQL เป็น production
- `ALERT_API_KEY` เป็น key ฝั่ง server สำหรับ service/BFF ไม่ใช่รหัส login และไม่ใส่ใน browser
- `GOOGLE_APPLICATION_CREDENTIALS` เป็นพาธไฟล์ JSON จริงใน Linux container ต้อง mount แบบ read-only ให้ UID `65532` อ่านได้ ไม่ใช่ JSON string ใน env และไม่ใช่ Android `google-services.json` หรือ Nortezh key
- FCM credentials/token ต้องตรง Firebase project ของ APK ใช้ส่งจริงก็ต่อเมื่อพร้อมและได้รับอนุมัติ ไม่ถือ `/health` หรือ provider acceptance เป็นหลักฐานว่ามือถือรับ/ดัง
- `ACK_PUBLIC_BASE_URL` เป็น HTTPS base ที่มือถือเข้าถึงได้ ระบบเติม Ack path เอง ไม่ใช้ Web URL/internal DNS ที่มือถือไปไม่ถึง

### บัญชีครั้งแรก

- ตั้ง initial password ผ่าน private runtime Secret ผู้เข้าเว็บคนแรกไม่สามารถสร้าง/ยึดบัญชีเอง
- ชื่อบัญชีเป็น case-sensitive ยาว 3–64 ASCII `A-Z a-z 0-9 _ . -`; รหัส bootstrap ยาว 32–128 UTF-8 bytes ไม่ใช่จำนวนตัวอักษรที่เห็นบนจอ
- Bootstrap ใช้สร้างบัญชีเมื่อยังไม่มีเท่านั้น Restart/redeploy หรือเปลี่ยนค่า bootstrap env ต้องไม่ reset password ที่ผู้ดูแลตั้งแล้ว
- ไม่ตั้ง bootstrap ขณะยังไม่มีบัญชี: login ไม่พร้อม แต่ไม่ควรปิดความสามารถ alert API เดิมเพราะเรื่องตั้งบัญชี Web
- Login ครั้งแรกต้องเปลี่ยน password ก่อนดูประวัติ/ส่งทดสอบ รหัสใหม่อย่างน้อย 15 Unicode code points ไม่เกิน 128 UTF-8 bytes และต้องต่างจากเดิมรวมถึงรหัส bootstrap ครั้งแรก
- Session มี absolute expiry 24 ชั่วโมง เปลี่ยน password แล้ว revoke session เดิมทั้งหมด Logout revoke session นั้น ไม่ใช้บัญชี browser ไปปลอม Ack บนมือถือ
- รอบนี้ไม่มี public signup หรือ anonymous forgot-password/reset-email ถ้าลืมรหัสต้องใช้วิธี operator ที่ตรวจสิทธิ์และอนุมัติแยก ไม่ลบ/แก้ข้อมูลในฐานจริงโดยเดา

## ส่วนขยาย Android บัญชีเดียวหลายเครื่อง

ส่วนนี้เป็นการเตรียม configuration ไม่ใช่หลักฐานว่าได้ rollout/ส่งถึงมือถือจริงแล้ว API ต้องมี public HTTPS ที่ APK เข้าถึงได้ และ `ACK_PUBLIC_BASE_URL` ต้องชี้เส้นทาง API รับทราบที่เข้าถึงจากมือถือได้ ไม่ใช้ internal hostname ของ Web BFF

- เพิ่ม `DEVICE_TOKEN_ENCRYPTION_KEY` ใน environment ของ **API เท่านั้น** เป็น base64url แบบไม่เติม padding ซึ่ง decode แล้วได้ 32 bytes ใช้ secret store/private configuration ที่ได้รับอนุญาต ห้ามใส่ใน APK, browser, Git หรือแชต
- เก็บ key นี้ให้คงเดิมข้าม restart/redeploy และทุก instance ที่ใช้ข้อมูลชุดเดียวกัน แยกจาก `ALERT_API_KEY` เพื่อหมุน application key ได้โดยไม่ทำให้ทะเบียน FCM เดิมอ่านไม่ได้ ห้ามสุ่มทับทุกครั้งที่เริ่ม process
- เมื่อยังไม่ตั้งค่าที่จำเป็น การลงทะเบียนต้องไม่สลับเส้นทางส่งเดิมไปเป็นระบบที่ยังส่งไม่ได้ ดู error ที่ API ตอบ ไม่สรุปจากการ login สำเร็จ
- เมื่อเริ่มใช้ทะเบียน จะเก็บปลายทางเดิมเป็นสมาชิกที่ยกเลิกได้ และรับเครื่องใหม่เพิ่ม ไม่ตัดเครื่องเดิมออกเพราะแฟน login ก่อน การลงทะเบียน token ของเครื่องเดิมต้องไม่เพิ่มปลายทางซ้ำ
- หลังเข้าสู่โหมดทะเบียนแล้ว การยกเลิกเครื่องสุดท้ายหมายถึงไม่มีปลายทาง ไม่ย้อนกลับไปส่งหา static token เก่า การ restart/rerun การเตรียมข้อมูลต้องไม่ปลุกทะเบียนที่ยกเลิกแล้วกลับมา
- ไม่ถอนข้อความที่กำลังส่งหรือหยุดเสียงที่เริ่มแล้วจากการ revoke/logout; กดรับทราบในเครื่องนั้นเอง Pending Ack ของเหตุการณ์เก่ายังต้อง sync ได้
- Native session เป็นของ installation แต่ละเครื่อง อายุ idle 30 วันและต่ออายุด้วยทะเบียนที่สำเร็จ ไม่ใช่ Web session 24 ชั่วโมง เปลี่ยนรหัสอาจทำให้เครื่องอื่นต้อง login ใหม่
- รายละเอียด API/การแสดงผล/ข้อผิดพลาดสำหรับ client อยู่ใน [shared-device handoff](fe-shared-devices-th.md) ไม่ใช้การคัดลอก master API key หรือ FCM token เป็นขั้นตอนปกติของ APK รุ่นใหม่

ก่อนให้ผู้ใช้สองเครื่องใช้งานจริง ต้อง deploy API ที่รองรับ contract นี้และตั้ง secrets/HTTPS ให้พร้อมก่อน แล้วสร้าง APK ด้วย signing workflow เดิม อย่า uninstall/reset แอปเดิมเพื่อฝืนติดตั้ง APK คนละ signer เพราะอาจทำให้ข้อมูลรับทราบและ pending Ack ในเครื่องหายไป การอนุมัติทำฟีเจอร์ไม่ใช่การอนุมัติ deploy/ส่ง FCM จริง

## Web — notify-alarm-web

```dotenv
HOSTNAME=0.0.0.0
PORT=3010
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
DASHBOARD_DEMO_MODE=false
DASHBOARD_PUBLIC_URL=https://<public-web-domain>
BACKEND_URL=https://<api-domain>
BACKEND_API_KEY=<same-value-as-API-ALERT_API_KEY>
```

- `DASHBOARD_PUBLIC_URL` เป็น canonical origin ที่ browser เปิดจริง ไม่มี credentials/path/query/fragment Public ต้อง HTTPS; เฉพาะ loopback HTTP ที่ระบุชัดใช้เพื่อ local tests ได้ ไม่ใช่ช่องเปิด insecure public deployment
- Ingress ต้อง preserve public `Host` ให้ตรง canonical origin แม้ต่อเข้า Node ผ่าน HTTP BFF ไม่เชื่อ arbitrary `X-Forwarded-Host`/`X-Forwarded-Proto` ที่ผู้เรียกป้อน
- ใช้ host-only Secure/HttpOnly/SameSite cookie ผ่าน HTTPS ไม่ต้องตั้ง `SESSION_SECRET` หรือ `NEXT_PUBLIC_*` สำหรับ app/session key
- `BACKEND_URL` เป็น API origin ที่ Web server เข้าถึงได้ ไม่ใช่ Web URL และไม่ต้องเข้าถึงได้จาก browser
- `BACKEND_API_KEY_FILE=/secrets/backend-api-key` ใช้แทน scalar env ได้ ไฟล์มีลำดับความสำคัญกว่า `BACKEND_API_KEY`; mount ให้ user `node` อ่านได้
- `DASHBOARD_DEMO_MODE` เป็นป้ายแสดงผล ไม่สร้าง fixture/ไม่สลับ sender ไปจำลอง/ไม่ปิดการส่งจริงด้วยตัวมันเอง ห้ามใช้เป็น safety gate ของ production provider

### ถ้า Web เรียก API ผ่าน internal HTTP

```dotenv
BACKEND_URL=http://<internal-api-host>:8787
BACKEND_ALLOWED_HTTP_ORIGINS=http://<internal-api-host>:8787
```

กำหนด exact origin รวม port ตาม service จริง ไม่ใช้ wildcard หรือ URL จาก request หลาย origin แยก comma ได้เฉพาะที่ operator ยืนยัน ห้ามเพิ่ม host ภายนอกเพื่อให้ validation ผ่านโดยไม่ตรวจ trust/network `ACK_PUBLIC_BASE_URL` ยังต้องเป็น public HTTPS สำหรับมือถือ แยกจาก internal URL นี้

## ลำดับเตรียมก่อน rollout

1. ตรวจฐาน/backup/migration ownership และ secrets/file mounts ของ API ตามขอบเขตที่อนุมัติ
2. ตั้ง private bootstrap credential และ deploy API รุ่นที่รองรับ dashboard session ก่อน Web รุ่นใหม่ ไม่ fallback ไป legacy app-key-only read routes เมื่อ auth service ไม่พร้อม
3. ตั้ง public Web HTTPS/canonical Host และ backend origin/key ให้ตรงกัน ห้ามอ้างว่าการบันทึก env คือ rollout สำเร็จ
4. Login → เปลี่ยนรหัส → ตรวจว่า bootstrap/old session ใช้เข้าข้อมูลไม่ได้ แล้วตรวจประวัติ
5. การส่งทดสอบจริงต้องยืนยันปลายทาง/normal หรือ critical ก่อน Critical ที่เริ่มแล้วต้องกดหยุดบนมือถือ ไม่ใช้ TTL เป็นตัวหยุด

งานพัฒนาและ browser fixture ใช้ loopback-only PostgreSQL ชั่วคราวกับ synthetic sender แยก ไม่อ่าน credential ของจริง ไม่ส่ง FCM ไม่เชื่อมฐานจริง และไม่ใช่หลักฐาน Pixel Ack → production API สำเร็จ
