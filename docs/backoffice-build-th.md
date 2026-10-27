# Build backoffice: Next.js dashboard / Docker / GitHub Actions

## 1. ขอบเขต

backoffice ของ notify-android คือโฟลเดอร์ **`dashboard/`** ไม่ใช่ `frontend/` ในตัวอย่างที่คัดลอกมา ใช้ Node 22.19.0, pnpm 10.33.0 และ `pnpm-lock.yaml` ไม่ใช้ `npm ci`, `package-lock.json` หรือ script lint ที่ไม่มีใน package นี้

ไฟล์ที่เกี่ยวข้อง:

- `.github/workflows/web-ci.yaml`: **Validate Notify Web** ไม่มี staging environment
- `dashboard/Dockerfile`: multi-stage build และ runtime แบบ non-root (`node`)
- `dashboard/.dockerignore`: allowlist สำหรับ context `dashboard/` เท่านั้น
- `dashboard/next.config.ts`: `output: 'standalone'` เพื่อลด runtime dependencies

API มี CI แยกที่ `.github/workflows/api-ci.yaml` และไม่สรุปว่า API พร้อมใช้เพราะ backoffice build ผ่าน

## 2. Pipeline และผลลัพธ์

Trigger: push เข้า `main` เป็น build หลักและส่งต่อ delivery หลัง tests/dockerize ผ่าน, เปิด/อัปเดต `pull_request` ที่มี base เป็น `main`, หรือกด `workflow_dispatch` โดย push/PR กรองการแก้ `dashboard/**` / `.github/workflows/web-ci.yaml` / `.github/workflows/deliver-notify-api-nortezh.yml` ไม่รันจาก push topic branch โดยตรงหรือ tag และไม่สร้าง staging deployment PR จาก fork อาจต้องให้ผู้ดูแลอนุมัติตาม GitHub policy

1. Checkout → ติดตั้ง pnpm/Node ตาม version ที่ระบุ
2. `pnpm install --frozen-lockfile`
3. `pnpm exec next typegen` → `pnpm typecheck` → `pnpm test` → `pnpm build`
4. เมื่อ test job ผ่าน จึง build image `linux/amd64` จาก **context `./dashboard`** และ Dockerfile `./dashboard/Dockerfile`
5. Load image เข้า runner แล้ว smoke test ว่า process user เป็น `node`, หน้า `/` ตอบสำเร็จ, BFF ทั้งสามเส้นทางรับ localhost และตอบ invalid query/ID ด้วย 400 (ไม่ใช่ถูก guard ปฏิเสธ 403) และยังปฏิเสธ Host ภายนอกด้วย 403 โดยไม่ต้องใช้ backend
6. Export `docker save` เป็น `backoffice-image.tar` ใน Actions artifact ชื่อ `backoffice-image-<commit SHA>` เก็บ 3 วัน ดาวน์โหลดแล้วใช้ `docker load -i backoffice-image.tar` ได้

7. เฉพาะ `github.event_name == 'push' && github.ref == 'refs/heads/main'` เรียก `.github/workflows/deliver-notify-api-nortezh.yml` ด้วย `app: web` หลัง `needs: dockerize` เพื่อ publish image ที่ทดสอบแล้วและ deploy; PR/manual แม้เลือก `main` ก็เป็น build-only ไม่ publish/deploy

Build/test ใช้ `contents: read`; ให้ `packages: write` เฉพาะ delivery job ไม่ใช้ `secrets: inherit` และไม่ให้ DB/FCM/API credentials แก่ build ส่วน reusable flow ตรวจ source → protected environment `notify-web-production` → target/runtime/access preflight **ก่อน GHCR push** → download artifact ของ run ปัจจุบัน → `docker load` image `notify-backoffice:${github.sha}` → retag/push image เดิมและบันทึก digest → Nortezh ใช้ exact tag เดียวกัน ไม่มี rebuild ใน delivery และไม่ cancel deployment ที่กำลังทำงานเมื่อมี push ใหม่ ดู [handoff และ environment variables](nortezh-go-delivery-th.md) ไม่มี staging หรือ release-tag caller และไม่ใช้ `smart-breaker-web`

Web target คือ `internal-tools` / `olufy-0` / `notify-alarm-web`, WebService พอร์ต 3010 ต้องตรวจ existing target และ runtime จริงก่อนตั้ง `NTZ_EXISTING_TARGET_CONFIRMED=true`, `NTZ_RUNTIME_READY=true`; ต้องตั้ง authenticated ingress/private access แยกและยืนยัน `NTZ_WEB_ACCESS_PROTECTED=true` ด้วย ไม่ได้เพิ่ม login หรือขยาย Host gate และ external default requests ยัง 403

Smoke test ยืนยันแค่ image เริ่มเซิร์ฟเวอร์/ข้อจำกัด Host ไม่ยืนยันว่าเชื่อม backend, PostgreSQL, FCM หรือ Pixel สำเร็จ

## 3. Build ในเครื่อง

จาก repo root (ต้องมี Docker Desktop Linux engine เปิดอยู่):

```powershell
docker build --file dashboard/Dockerfile --tag notify-backoffice:local dashboard
docker run --rm --name notify-backoffice-local -p 127.0.0.1:3010:3010 notify-backoffice:local
```

ถ้า 3010 มี dashboard เดิมใช้อยู่ อย่า kill process อื่นหรือ build ทับ `.next` ของ server ที่กำลังทำงาน ให้หยุด demo ของตนเองก่อนรันทดแทน ตรวจด้วย `Get-NetTCPConnection -LocalPort 3010 -State Listen`

เปิด `http://127.0.0.1:3010` ได้ แต่ถ้าไม่ตั้ง backend จะมี error โหลดประวัติตามจริง ไม่สร้างข้อมูลส่งจริงให้เอง โดย `127.0.0.1` **ภายใน container ไม่ใช่เครื่อง host และไม่ใช่ Go API container อื่น**

Context เป็น dashboard อย่างเดียว ไม่ใช้คำสั่ง `docker build .` ที่ root เพราะ root Dockerfile เป็น Node bridge เดิม ไม่ใช่ backoffice ห้าม copy repository ทั้งก้อนเพื่อแก้ COPY error เพราะมี Firebase/private token files อยู่นอก dashboard

## 4. Runtime environment และ secrets

Build ไม่ต้องใช้ API key, Firebase credential, database URL หรือ backend ที่เปิดอยู่ ห้ามส่ง secrets เป็น `ARG`, `NEXT_PUBLIC_*` หรือคัดลอก `.env` เข้า image ค่า server-side อ่านตอน runtime:

การ pin Node/pnpm ทำให้ build ทำซ้ำได้ ไม่ใช่หลักฐานว่า image ไม่มีช่องโหว่ ต้องสแกน/อัปเดต base image แยกก่อนใช้งาน production

| ตัวแปร | หน้าที่/ข้อจำกัด |
|---|---|
| `PORT` | ค่า default ใน image คือ 3010 |
| `HOSTNAME` | image ใช้ `0.0.0.0` ภายใน container เพื่อให้ port mapping ใช้งานได้ ไม่ได้หมายถึงอนุญาต public access |
| `BACKEND_URL` | URL Go API; non-loopback ต้อง HTTPS ตาม policy เดิม ไม่รับ user/password/query/hash ใน URL |
| `BACKEND_API_KEY_FILE` | พาธไฟล์ key ภายใน container เช่น `/run/secrets/backend-api-key` มีลำดับความสำคัญกว่า env key |
| `BACKEND_API_KEY` | ทางเลือก runtime env เฉพาะ server; ไม่ใช่ค่า build และไม่ส่งให้ browser |
| `DASHBOARD_DEMO_MODE` | ตั้ง `true` เฉพาะข้อมูลสาธิตเพื่อแสดงป้ายเตือน ไม่สร้าง fake success และไม่ซ่อน upstream error |

ตัวอย่าง mount key (placeholder; อย่าใส่ key จริงในแชต/source):

```powershell
docker run --rm --name notify-backoffice-local `
  -p 127.0.0.1:3010:3010 `
  --env BACKEND_URL=https://notify-api.example.org `
  --env BACKEND_API_KEY_FILE=/run/secrets/backend-api-key `
  --mount "type=bind,source=D:\private\notify-alarm\backoffice-api-key.txt,target=/run/secrets/backend-api-key,readonly" `
  notify-backoffice:local
```

URL ข้างบนไม่ใช่ production endpoint ของโครงการ ไฟล์ต้องอ่านได้ด้วย user `node` ภายใน container และ host ต้องจำกัดคนอ่านไฟล์ให้เหมาะสม ไม่ใช่เปิด world-readable เพื่อให้ run ผ่าน

## 5. ขอบเขตความปลอดภัยก่อน deploy

ยังคง **localhost-only BFF** และ read-only UI เดิม: GET `/api/history`, `/api/stats`, `/api/alerts/{id}` ส่งต่อเฉพาะ GET `/v1/history`, `/v1/stats`, `/v1/alerts/{id}` ไม่ส่งแจ้งเตือนหรือ Ack จาก dashboard

การ bind `0.0.0.0` ภายใน container กับการอนุญาต user เป็นคนละเรื่อง ใช้ `-p 127.0.0.1:...` สำหรับ local test ไม่เปิด `-p 3010:3010` สู่ LAN/internet โดยไม่ตั้งใจ Host/Origin gate ไม่ใช่ระบบยืนยันตัวตน จึง **ยังไม่พร้อมเปิด public domain** โดยแค่เอา image นี้ deploy ต้องออกแบบ auth/access proxy และ origin policy ที่เหมาะสมก่อน ไม่แก้ gate ให้รับทุก host เพื่อให้ deployment ผ่าน

Next standalone อาจสร้าง request URL ภายในจาก bind address `0.0.0.0` ตัว guard จึงแยก metadata นี้ออกจาก Host ที่ผู้ใช้ส่ง: ยอมรับ URL ภายในดังกล่าวเฉพาะเมื่อ Host จริงเป็น loopback, port ตรงกัน และ Origin (ถ้ามี) ตรงกับ Host ไม่ยอมรับ `Host: 0.0.0.0`, LAN IP หรือ public domain

BFF ไม่ตาม upstream redirect, จำกัด response 1 MiB, ตรวจ DTO และซ่อน credential ตามเดิม ดูรายละเอียด API/permissions/timing/errors ใน [service integration](service-integration-th.md) และ [dashboard local](dashboard-local-th.md)

## 6. Checklist

- [ ] รัน workflow บน repository จริงและตรวจ test/image/smoke jobs ผ่าน
- [ ] ตรวจ tar/image ว่าไม่มี `.env`, service-account, device token หรือข้อมูลส่วนตัว
- [ ] ตั้ง backend HTTPS และ runtime secret file โดยไม่ฝังลง build
- [ ] ทดสอบประวัติ/สถิติ/รายละเอียดด้วย backend ที่ตั้งใจใช้ ไม่ตีความหน้า `/` 200 ว่า DB พร้อม
- [ ] อนุมัติ auth/domain/deploy target แยกก่อนเปิดภายนอก ไม่ใช้ชื่อบริการ smart-breaker จาก template

## 7. ผลตรวจในเครื่อง / สิ่งที่ยังไม่ยืนยัน

ตรวจด้วย clean install ใน temporary sandbox แยก เพื่อไม่เขียนทับ `.next` ของ dashboard ที่เปิดอยู่: frozen lockfile install, Next typegen/typecheck, tests 7 เคส และ production standalone build ผ่าน รวม regression สำหรับ bind metadata กับ client Host/Origin ตรวจ workflow ด้วย actionlint ผ่าน (ไม่รวม optional shellcheck ที่ไม่ได้ติดตั้ง)

ทดสอบ standalone บน Windows/loopback จริงแล้ว: หน้า `/` และ static asset ตอบ 200, BFF ทั้งสามเส้นทางผ่าน local guard ไปถึง query/ID validation (400), foreign Host/Origin ถูกปฏิเสธ 403 โดยส่ง raw HTTP headers จริง ไม่ใช้ backend/credential และหยุด process ทดสอบแล้ว ผลนี้ไม่ใช่การทดสอบ Linux container

ผล local ข้างต้นเป็นหลักฐานเดิม ไม่ใช่ผล delivery ชุดใหม่ มี main CI รุ่น build-only ที่ผ่านก่อนหน้านี้ แต่ **ยังไม่ได้รัน configuration main-delivery ใหม่บน GitHub และยังไม่มี live image publication/deployment ในงานนี้** ไม่สรุปว่า container/production พร้อมจาก Next build บน Windows หรือ CI รุ่นก่อน ต้องตรวจ run/image digest/Nortezh revision/runtime/access จริงภายหลัง
