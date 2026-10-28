# Build backoffice: Next.js dashboard / Docker / GitHub Actions

## 1. ขอบเขต

backoffice ของ notify-android คือโฟลเดอร์ **`dashboard/`** ไม่ใช่ `frontend/` ในตัวอย่างที่คัดลอกมา ใช้ Node 22.23.4, pnpm 10.33.0 และ `pnpm-lock.yaml` ไม่ใช้ `npm ci`, `package-lock.json` หรือ script lint ที่ไม่มีใน package นี้

Node pin อัปเดตตาม [security release 21 ต.ค. 2026 ของ Node.js](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) และ [release index ทางการ](https://nodejs.org/dist/index.json): `22.23.4` เป็น security patch ล่าสุดในสาย 22 ณ วันที่ตรวจ 28 ต.ค. 2026 จึงคง major เดิม ไม่ข้ามไป Node 24/26 โดยอัตโนมัติ ทั้ง Web CI, Docker build/runtime และ Node bridge image ใช้ patch เดียวกัน ไม่เปลี่ยน Node global ของเครื่อง Pin นี้ไม่แทน vulnerability scan ของ Debian/npm dependencies และไม่ใช่หลักฐานว่า image ใหม่ถูก deploy แล้ว

ไฟล์ที่เกี่ยวข้อง:

- `.github/workflows/web-production.yaml`: standalone **Deploy Notify Web To Production** ตาม Nick Skills `4a70d2f` มีสอง jobs `dockerize_n_push → deploy` เท่านั้น ไม่มี reusable/caller หรือ staging
- `docs/deployment/nortezh-workflows.json`: reviewed-template adaptation ไม่ใช่ portable renderer input โดยตรง; ดูข้อจำกัดใน [คู่มือ delivery](nortezh-go-delivery-th.md) ห้ามใช้ CLI `--apply` กับ manifest นี้ตรง ๆ
- `tools/test-standalone-nortezh.mjs`: project workflow contract tests
- `dashboard/Dockerfile`: multi-stage build และ runtime แบบ non-root (`node`)
- `dashboard/.dockerignore`: allowlist สำหรับ context `dashboard/` เท่านั้น
- `dashboard/next.config.ts`: `output: 'standalone'` เพื่อลด runtime dependencies

API มี standalone workflow แยกที่ `.github/workflows/api-production.yaml` ใช้ root `Dockerfile.go` context `.` และไม่สรุปว่า API พร้อมใช้เพราะ backoffice build ผ่าน ไม่ย้าย Dockerfiles หรือเพิ่ม Swagger

## 2. Pipeline และผลลัพธ์

Trigger: push เข้า `main` หรือ `workflow_dispatch` แบบ branch build โดย push filters รวม `dashboard/**`, workflow ของตน, `tools/test-standalone-nortezh.mjs`, `docs/deployment/nortezh-workflows.json` และสกิลสองไฟล์ที่ใช้จริง `.skills/deploying-go-to-nortezh/scripts/render-workflows.mjs`, `.skills/deploying-go-to-nortezh/assets/workflow-service.yaml.tmpl` Docs/skills อื่นไม่ trigger ยกเว้นอยู่ใน `dashboard/**` ไม่รัน PR, topic push หรือ tag ตามนโยบายเดิม ไม่มี staging/release Operator ต้องทบทวนชื่อ required PR checks เก่าที่อาจรอค้าง งานนี้ไม่เปลี่ยน GitHub settings

1. `dockerize_n_push`: checkout exact `github.sha` โดย `persist-credentials: false` → ตรวจ event/revision → Node 22.23.4 → workflow contract tests → pnpm 10.33.0
2. `pnpm install --frozen-lockfile` → `pnpm exec next typegen` → `pnpm typecheck` → `pnpm test` → `pnpm build` ทั้งหมดก่อน login/build-push
3. คง canonical action/order พร้อม approved compatibility override: checkout@v4 → QEMU@v3 → Buildx@v3 → login@v3 → ASzc lowercase@v6 → build-push@v6 → Nortezh@v1.0.5 ไม่อ้างว่า version tags เหล่านี้ SHA-pinned Login เฉพาะ main push
4. Build `linux/amd64` จาก **context `./dashboard`**/`./dashboard/Dockerfile` พร้อม GHA cache โดย build-push ใช้ `load: true` และ push เฉพาะ main push เป็น output เดียวกัน Tag คือ `ghcr.io/<owner>/<repo>/notify-web:<short SHA>` จาก `git rev-parse --short HEAD` เป็น mutable tag เขียนทับได้/มี collision risk ไม่ใช่ run-unique full-SHA tag ไม่มี exported tar หรือ Actions image artifact; APK artifacts ไม่เปลี่ยน
5. **หลัง build+push** ตรวจ user `node`, หน้า `/` สำเร็จแบบ bounded localhost smoke, BFF invalid query/ID 400 และ foreign Host 403 โดยไม่ใช้ backend credentials ก่อนส่ง outputs ดังนั้น smoke ล้มอาจมี image ใน GHCR แล้ว แต่ deploy ถูกบล็อก
6. ส่ง `image_name` พร้อมบันทึก published digest ใน summary; `deploy` เฉพาะ main push หลัง job แรกผ่าน เข้า environment `notify-web-production` ตรวจชื่อ secrets ที่ขาด และส่ง exact short-tag output ให้ Nortezh ไม่ใช่ digest deployment/readiness guarantee

Manual แม้เลือก main ทำ tests/build/load แต่ไม่ login/push/deploy Job แรกมี `contents: read`, `packages: write`, `attestations: write` ตาม template; deploy มี `permissions: {}` และ service-account secrets เฉพาะ job นี้ Main deployments ไม่ cancel จาก push ใหม่ ดู [handoff และ runtime prerequisites](nortezh-go-delivery-th.md)

Web target อยู่ inline YAML: `internal-tools` / `olufy-0` / `notify-alarm-web`, WebService พอร์ต 3010 ไม่ต้องตั้ง NTZ Variables ห้ารายการ ใช้ Secrets สองชื่อ `NTZ_SA_EMAIL`, `NTZ_SA_KEY` ใน environment เท่านั้น Built-in `GITHUB_TOKEN` ไม่ต้อง provision ไม่มี custom readiness flags; validation ไม่พิมพ์ค่า email/key และไม่พิสูจน์ authentication ผู้ดูแลยังต้องตั้ง environment reviewers/branch policy (ชื่อ environment ไม่ใช่หลักฐานว่าตั้งแล้ว), ตรวจ existing target หรือขออนุมัติสร้างเพราะ action อาจสร้าง deployment, GHCR pull access/runtime และ authenticated ingress/private access แยก ไม่ได้เพิ่ม login หรือขยาย Host gate; external default requests ยัง 403

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
- [ ] ตรวจ image ว่าไม่มี `.env`, service-account, device token หรือข้อมูลส่วนตัว
- [ ] ตั้ง backend HTTPS และ runtime secret file โดยไม่ฝังลง build
- [ ] ทดสอบประวัติ/สถิติ/รายละเอียดด้วย backend ที่ตั้งใจใช้ ไม่ตีความหน้า `/` 200 ว่า DB พร้อม
- [ ] อนุมัติ auth/domain/deploy target แยกก่อนเปิดภายนอก ไม่ใช้ชื่อบริการ smart-breaker จาก template

## 7. ผลตรวจในเครื่อง / สิ่งที่ยังไม่ยืนยัน

หลักฐานก่อนหน้า (ไม่ใช่ standalone workflow รอบนี้): clean install ใน temporary sandbox แยก เพื่อไม่เขียนทับ `.next` ของ dashboard ที่เปิดอยู่ ผ่าน frozen lockfile install, Next typegen/typecheck, tests 7 เคส และ production standalone build รวม regression สำหรับ bind metadata กับ client Host/Origin; workflow รุ่นนั้นผ่าน actionlint (ไม่รวม optional shellcheck ที่ไม่ได้ติดตั้ง)

ทดสอบ standalone บน Windows/loopback จริงแล้ว: หน้า `/` และ static asset ตอบ 200, BFF ทั้งสามเส้นทางผ่าน local guard ไปถึง query/ID validation (400), foreign Host/Origin ถูกปฏิเสธ 403 โดยส่ง raw HTTP headers จริง ไม่ใช้ backend/credential และหยุด process ทดสอบแล้ว ผลนี้ไม่ใช่การทดสอบ Linux container

ผล local ข้างต้นเป็นหลักฐานเดิม ส่วน [main Web run 40633786594](https://github.com/nickza2026/nick-notify-android/actions/runs/40633786594) ที่ commit `86fbc4f` ใช้ workflow เก่า: ผ่าน Web tests/build และ Linux container smoke แต่หยุดที่ `approve-target` ก่อน publish/deploy รุ่น standalone ใหม่ปรับหก action versions ตามที่อนุมัติแล้ว ผ่าน project tests 10 ข้อและ actionlint; skill snapshot เดิมผ่าน tests 25 ข้อ ดู [compatibility override และผลตรวจ](nortezh-go-delivery-th.md) Docker Linux engine ยังไม่พร้อม ไม่มี image build/smoke/GitHub execution/rollout รุ่นใหม่ และยังไม่ยืนยัน runtime/public UI หรือ Pixel → Go Ack
