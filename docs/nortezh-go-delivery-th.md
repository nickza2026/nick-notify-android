# เตรียม Go API สำหรับ GHCR → Nortezh (ยังไม่เผยแพร่หรือ deploy)

เอกสารนี้เป็น **handoff แบบ production-only ตามคำขอผู้ใช้** ไม่มี staging delivery ไม่ใช่รายงานว่า Go API มี URL ใช้งานแล้ว `.github/workflows/api-ci.yaml` และ `web-ci.yaml` ใช้ `main` เป็น build หลักและตรวจ PR เข้า `main` โดย test + build Docker image ด้วย `push: false`; ไม่เขียน GHCR, ไม่สร้าง revision บน Nortezh และไม่แตะฐานข้อมูลภายนอก

## ไฟล์และขอบเขต

| ไฟล์ | สถานะ/หน้าที่ |
|---|---|
| `Dockerfile.go` + `Dockerfile.go.dockerignore` | ใช้ root Docker context แบบ allowlist แต่ Go module จริงอยู่ `backend/`; build `backend/cmd/notify-api`, binary Linux/amd64, runtime distroless UID 65532, `HOST=0.0.0.0`, `PORT=8787` |
| `.github/workflows/api-ci.yaml` | CI: gofmt, build, vet, tests กับ embedded PostgreSQL, Docker Buildx **ไม่ push**; รันอัตโนมัติเมื่อ push เข้า `main` หรือเปิด/อัปเดต PR เข้า `main` ที่เปลี่ยนไฟล์ Go/workflow/Docker ที่เกี่ยวข้อง และยังเลือก manual run ได้ |
| `.github/workflows/deliver-notify-api-nortezh.yml` | reusable `workflow_call` เท่านั้น: verify → approve-target → publish GHCR → deploy Nortezh; **ยังไม่มี active caller** จึงไม่ทำงานเพราะ push/release หรือกด Run workflow ตรง ๆ |
| `deploy/nortezh/notify-api-production.yml.example` | **ตัวอย่างเฉย ๆ**; หากอนุมัติให้ย้ายเป็น `.github/workflows/notify-api-production.yml` จึงเริ่มจาก release `published` ที่ไม่ใช่ prerelease ไม่มี push-main deploy |

ชื่อ Go app คือ `notify-api` (ไม่ใช่ชื่อ app `user/admin` ของ source skill); ผู้ใช้ยืนยัน Nortezh **project ID `internal-tools` / location `olufy-0`** และเลือกชื่อ deployment ใหม่ว่า **`notify-alarm-api`** ให้ตรงงานนี้ ค่า ID/location มาจากผู้ใช้ ยังไม่ได้ตรวจใน Nortezh จริง และชื่อใหม่คือแผน ไม่ใช่หลักฐานว่ามี target บน Nortezh แล้ว เลือก **WebService** และพอร์ต **8787** ไม่ใช่ Worker หรือพอร์ต default 80 ไม่มี Swagger generator ที่ต้องเรียกใน build: migration `backend/migrations/001_init.sql` ฝังใน binary ด้วย `go:embed` อยู่แล้ว; ไม่ต้องคัดลอก SQL เข้า runtime image แยกหรือใส่ไฟล์ service-account ใน image

### Automatic CI ไม่ใช่ automatic deploy

- push เข้า `main` เป็น build หลัก ไม่ trigger จาก topic branch หรือ tag; PR ตรวจเฉพาะ base `main` ผ่าน event `pull_request` ปกติ ไม่ใช่ `pull_request_target` และไม่รับ production secrets workflow มีเพียง `contents: read` และ checkout ไม่เก็บ Git credentials ไว้ให้โค้ดที่ทดสอบ
- ทั้ง push/PR ของ API กรอง path เดียวกัน: `backend/**` (รวม Go module/migrations), `Dockerfile.go`, `Dockerfile.go.dockerignore`, `.github/workflows/api-ci.yaml` และ `.github/workflows/deliver-notify-api-nortezh.yml` การแก้เฉพาะ Android/dashboard/docs ไม่เริ่ม Go CI ส่วน Web ใช้ `dashboard/**` และ `.github/workflows/web-ci.yaml`
- PR ตรวจ merge revision ก่อนรวมเข้า `main`; เมื่อ merge แล้ว main build จะตรวจ commit จริงอีกครั้ง ยกเลิกเฉพาะ run เก่าที่มี event/ref เดียวกัน ไม่ยกเลิก production deployment การลบไฟล์ CI ชื่อ staging เดิมไม่ได้ลบประวัติ run บน GitHub
- Docker build รอ Go tests ผ่านก่อน และคง `push: false`; ไม่มี login GHCR, Nortezh action หรือ environment production ใน CI นี้ การ push branch จึงไม่ publish image หรือ deploy
- การเปลี่ยน trigger ต้อง commit/push ขึ้น branch ก่อนจึงเริ่มอัตโนมัติได้ ส่วน PR event จาก fork อาจต้องให้ผู้ดูแลอนุมัติ workflow ตาม GitHub policy ไม่ได้ข้ามข้อจำกัดนี้

## GitHub Environments ก่อนเปิด caller

ผู้ดูแลต้องตรวจค่าที่ผู้ใช้ให้มาใน Nortezh ว่า action รับ project ID `internal-tools` กับ location `olufy-0` จริง และเตรียม/ยืนยัน production deployment ชื่อ `notify-alarm-api` บน Nortezh ก่อน ไม่ส่งค่าของ Secret ในแชตหรือใส่ไฟล์ใน repo ใช้ GitHub environment เดียวคือ `notify-api-production` พร้อม required reviewers/branch policy ตามทีม (GitHub อาจสร้าง environment เปล่าให้อัตโนมัติหากสะกดชื่อผิด จึงไม่ถือว่าแค่มีชื่อคือได้รับอนุมัติ) workflow ตรวจค่าทั้งสามให้ตรงก่อน publish/ก่อน deploy และไม่เติม suffix ให้ชื่อ target

| ชื่อใน `notify-api-production` | ประเภท | ข้อกำหนด |
|---|---|---|
| `NTZ_PROJECT`, `NTZ_LOCATION`, `NTZ_DEPLOYMENT` | Variables | `internal-tools`, `olufy-0`, `notify-alarm-api` ตามลำดับ; guard จะ fail หากไม่ตรง แต่ต้องตรวจใน Nortezh UI/API อีกครั้งก่อนตั้งค่า |
| `NTZ_TYPE`, `NTZ_PORT` | Variables | `WebService` และ `8787` เท่านั้นสำหรับ Go API นี้ |
| `NTZ_EXISTING_TARGET_CONFIRMED` | Variable | ตั้ง `true` **หลัง** ผู้ดูแลเตรียม/ตรวจว่า target `notify-alarm-api` มีอยู่จริงใน project `internal-tools` และตรง location/type; action `deployment.create-revision` อาจสร้าง deployment ที่ยังไม่ตั้งค่าเองถ้าชื่อผิด |
| `NTZ_RUNTIME_READY` | Variable | ตั้ง `true` **หลัง** ยืนยัน PostgreSQL, credentials, image pull, ทรัพยากร และ HTTPS/health ของ production จริง; เป็น attestation ไม่ใช่ health proof |
| `NTZ_SA_EMAIL`, `NTZ_SA_KEY` | Secrets | Nortezh service account ของ environment นั้น; action รับชื่อ `SA_AUTH_EMAIL`/`SA_AUTH_KEY` ภายใน job deploy เท่านั้น |

ก่อน publish ต้องผ่าน Go tests แบบ **ไม่รับ credential ของ Nortezh/DB/FCM**; `approve-target` ใช้ protected environment ตรวจ vars/secrets ก่อน `publish` จึงไม่ push image เมื่อค่ายังว่าง งาน `deploy` เข้า environment อีกครั้ง (อาจต้องให้ reviewer อนุมัติ **สอง job**) และตรวจ target ซ้ำก่อนเรียก action แต่ attestation ไม่แทนการตรวจว่าปลายทางเป็น deployment ที่ตั้งใจจริง

Image จะเป็น `ghcr.io/nickza2026/nick-notify-android/notify-api:<full-commit-sha>-<run-id>-<attempt>` และบันทึก digest ใน Actions summary; deploy ใช้ **tag เดียวกันจาก publish job output** ไม่ใช้ `latest` หรือสร้าง tag ใหม่ หาก Nortezh ดึง image GHCR private ไม่ได้ ต้องตั้ง pull access ฝั่ง Nortezh แยกจาก `GITHUB_TOKEN` ที่ GitHub Actions ใช้ push หาก platform รองรับ digest pinning ให้พิจารณาเปลี่ยนไป deploy digest หลังทดสอบจริง (unique tag อย่างเดียวไม่ใช่ immutable guarantee)

สำหรับ production GitHub ระบุว่า release event ใช้ `GITHUB_SHA` เป็น **commit ใน tagged release** ([GitHub Actions release event](https://docs.github.com/en/actions/reference/events-that-trigger-workflows#release)); verify job ยังตรวจ tag/ref และ resolve annotated หรือ lightweight tag ให้ตรง SHA นี้ก่อน test/publish ทั้งสอง job checkout SHA เดียวกัน ห้าม deploy จาก default branch แทน release โดยเดาชื่อ tag

## Runtime ที่ต้องมีบน Nortezh เอง

- `DATABASE_URL`: PostgreSQL ภายนอกที่ operator จัดการ ตั้งค่า TLS/backup และต้องเป็น `server_encoding=UTF8`; Go API จะ `Ping` และรัน SQL migration เมื่อเริ่ม ถ้าต่อ DB หรือ DDL ไม่ได้จะไม่เปิด listener ต้องสำรองและทบทวน schema/migration ก่อน revision ใหม่ เพราะ **ไม่มี staging DB ให้ซ้อม**; ห้ามยิง synthetic alert/DDL ทดลองใส่ข้อมูลจริงโดยไม่อนุมัติ
- `ALERT_API_KEY`: random key อย่างน้อย 32 bytes สำหรับ service caller เก็บเป็น platform Secret และแยกจาก token ที่ส่งให้ Android; ห้ามฝังใน APK
- `FCM_DEVICE_TOKEN` กับ `GOOGLE_APPLICATION_CREDENTIALS`: หากต้องส่ง FCM จริง ต้องใช้ registration token ปัจจุบันของ Pixel และ **path ของไฟล์ JSON service account ที่ platform mount อ่านได้โดย UID 65532** ไม่ใช่ raw JSON env, GitHub Secret ที่ถอดจาก APK หรือไฟล์ใน Docker image หาก Nortezh target ไม่มีวิธี mount secret file ที่ปลอดภัย ให้หยุดและตกลงทางเลือกก่อนเปลี่ยนโค้ด
- `HOST=0.0.0.0`, `PORT=8787`: Dockerfile กำหนดอยู่แล้ว; WebService ต้อง route ไปพอร์ตเดียวกัน ตรวจ health/readiness และ resource limits ฝั่ง Nortezh
- `ACK_PUBLIC_BASE_URL`: HTTPS base URL ที่ Pixel เข้าถึงได้จริงผ่าน TLS/reverse proxy ไป Go API; การตั้งตัวแปรเฉย ๆ ไม่ได้พิสูจน์ routing หรือ Ack สำเร็จ ปิด Authorization/body/access logs ของ proxy ไม่เปิด listener HTTP ตรงสู่อินเทอร์เน็ต

อย่าส่ง `DATABASE_URL`, service-account JSON, FCM token หรือ API key ในแชต/commit; เก็บผ่าน secret manager ที่ผู้ดูแลอนุมัติ การทดสอบบน Pixel ที่ผ่านมาเป็น Node→FCM→local Ack ไม่ใช่ Pixel→Go/PostgreSQL/HTTPS Ack

## ลำดับเปิดใช้หลังได้รับอนุมัติ

1. ยืนยันกับ Nortezh ว่า project ID `internal-tools` และ location `olufy-0` ถูกต้อง เตรียม target ใหม่ชื่อ `notify-alarm-api` ให้พร้อมก่อนใช้ action, ตรวจ registry visibility/pull access และ public HTTPS hostname; แยกค่า secret จริงไปช่องจัดการของ platform เท่านั้น
2. ตรวจ runtime config และ backup/แผน rollback ของ PostgreSQL production รวม migration ที่ Go จะรันตอนเริ่ม; ตั้ง GitHub environment `notify-api-production` พร้อม reviewers, vars และ secrets ข้างบน ยังไม่ย้าย caller template
3. อนุมัติ image publication และ live **production** deployment อย่างชัดเจนก่อนย้าย `notify-api-production.yml.example` เข้า `.github/workflows/`; ไม่มี main-push deploy หรือ staging ที่เป็น safety net ให้ใช้ release ที่ review แล้วเท่านั้น
4. เมื่อเปิด caller แล้ว ตรวจ job verify/publish/digest/target ทุก job และ Nortezh revision/image, GHCR pull, log, `/health`, PostgreSQL connection/migration และ HTTPS ingress จริง ถ้าพังอย่าถือว่า action สร้าง revision สำเร็จเท่ากับบริการพร้อม
5. ทดสอบ synthetic critical จาก Go ผ่าน HTTPS ไป Pixel และ Ack กลับ Go/PostgreSQL แบบได้รับอนุญาตในเวลาที่มือถือดังได้ ตรวจ `GET /v1/alerts/{id}` และ dashboard history/จำนวน action จาก DB เดียวกัน; การกดรับทราบหนึ่งครั้งต้องนับเป็นหนึ่ง action แม้ HTTP retry
6. หากจะออก release ถัดไป ให้ตรวจ tag→commit, image digest, สุขภาพ revision ก่อน/หลัง และแผน rollback จริง ไม่เชื่อว่าตาราง/DB ใหม่จะ backward-compatible เอง การเลือก production-only เพิ่มความเสี่ยงจึงห้ามตีความว่าการสร้าง revision เท่ากับระบบพร้อมใช้งาน

**หลักฐานขณะจัดทำ:** Go CI รุ่นก่อน build-only ผ่านบน GitHub; template delivery ใหม่นี้ยังไม่มี caller, ไม่เคย publish image/รันบน Nortezh และไม่มีการทดสอบ Pixel→Go Ack จริงจนกว่าจะมี URL/DB/runtime ที่ยืนยัน
