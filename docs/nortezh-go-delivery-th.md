# API + Web: main → GHCR → Nortezh (handoff ภาษาไทย)

ผู้ใช้ยืนยัน automatic production delivery สำหรับ API และ Web เมื่อ push `main` ตาม path filters และ tests/build ผ่าน ไม่มี staging ส่วน Android เป็น **manual-only** เอกสารนี้อธิบาย configuration ที่เตรียมในงานนี้ **ไม่ใช่หลักฐานว่า deploy แล้วหรือมี production URL พร้อมใช้** และไม่ใช่การอนุญาต commit/push เพิ่มเติม

## 1. Workflow และ trigger

| Workflow | หน้าที่ |
|---|---|
| `.github/workflows/api-ci.yaml` | push `main` ตาม Go/Docker/workflow paths และ manual: gofmt/build/vet/tests กับ embedded PostgreSQL → dockerize → artifact; เฉพาะ push `main` เรียก delivery ด้วย `app: api`; ไม่รันจาก PR |
| `.github/workflows/web-ci.yaml` | push `main` ตาม dashboard/workflow paths และ manual: frozen install/typegen/typecheck/tests/build → dockerize/smoke → artifact; เฉพาะ push `main` เรียก delivery ด้วย `app: web`; ไม่รันจาก PR |
| `.github/workflows/deliver-notify-api-nortezh.yml` | reusable `workflow_call`: source guard → protected environment/target preflight → publish tested image → deploy exact tag |
| `.github/workflows/android-apk.yaml` | `workflow_dispatch` เท่านั้น ไม่มี automatic Android compile บน push `main`; signed APK job เฉพาะ `main` และคง signer validation ตาม [คู่มือ APK](github-apk-build-th.md) |

ถอด PR trigger ทั้ง API/Web เพื่อประหยัด runner: เปิด/อัปเดต PR ไม่เริ่ม tests/build เลย แต่ยังตรวจ tests ก่อน deploy เมื่อ push `main` ส่วน manual แม้เลือก `main` **ไม่ publish/deploy** ไม่มี release/tag trigger; release-production `.example` เดิมถูกถอด ไม่ต้องย้าย template เข้า workflows อีก ไม่ใช้ topic branch push หรือ `pull_request_target` เพื่อ delivery

API push path filters ครอบคลุม `backend/**`, `Dockerfile.go`, `Dockerfile.go.dockerignore` และ API/shared delivery workflows; Web ครอบคลุม `dashboard/**` และ Web/shared delivery workflows ทั้งคู่รวม `tools/test-delivery-workflows.mjs` เพื่อให้การแก้ safety checks ถูกทดสอบ การแก้เฉพาะ docs ไม่เริ่ม deploy

Caller ใช้ `needs: dockerize` และ guard `github.event_name == 'push' && github.ref == 'refs/heads/main'` ทั้งสอง app ส่วน reusable ตรวจ main-push source ซ้ำและรับเฉพาะ `app: api`/`web` ก่อนเลือก environment **concurrency ต้องไม่ cancel in-flight main deployments** เมื่อมี push ใหม่ การรันมือที่ซ้ำกันยังยกเลิก run เก่าได้ ถ้า branch protection เดิมบังคับ PR status checks ที่ถูกถอด trigger นี้ ผู้ดูแลต้องปรับ required checks ให้สอดคล้อง มิฉะนั้น PR อาจรอ check ที่จะไม่รัน งานนี้ไม่แก้ branch protection บน GitHub เอง

## 2. ส่ง image เดียวกับที่ทดสอบ ไม่ rebuild

| App | Docker source/context | Artifact ของ run ปัจจุบัน | Image ภายใน tar |
|---|---|---|---|
| API | `Dockerfile.go` / root พร้อม `Dockerfile.go.dockerignore`; Go module อยู่ `backend/` | `notify-api-image-${github.sha}` มี `api-image.tar` | `notify-api:${github.sha}` |
| Web | `dashboard/Dockerfile` / `dashboard/`, Next standalone | `backoffice-image-${github.sha}` มี `backoffice-image.tar` | `notify-backoffice:${github.sha}` |

Dockerize รอ tests ผ่าน สร้าง/load/export image โดยไม่ push และ upload artifact สำเร็จก่อน delivery เริ่ม หลัง protected-environment preflight ผ่าน reusable download **artifact ใน run ปัจจุบันเท่านั้น** แล้ว `docker load` / retag / push image ที่ทดสอบแล้ว ไม่ rebuild จากอีก revision ไม่ดึง artifact ล่าสุดจาก run อื่น ถ้า artifact หาย/ชื่อผิดให้ fail ไม่ fallback

upload ใช้ `overwrite: true` เพื่อให้ re-run dockerize ใน run เดิมแทน artifact ชื่อเดิมได้; หาก re-run เฉพาะ delivery ที่ล้ม ยังใช้ artifact ที่ทดสอบผ่านของ run เดิม ไม่หยิบจาก run อื่น ส่วน tag GHCR รวม run attempt จึงไม่ทับ tag ของความพยายามก่อนหน้า

GHCR publish บันทึก digest ใน Actions summary/output แล้ว Nortezh ใช้ **exact tag เดียวกับที่ publish สำเร็จ** ไม่ใช้ `latest` หรือเดา tag ใหม่ Unique tag ไม่ใช่ immutable guarantee: ตรวจ digest/revision หลัง deploy และพิจารณา digest pinning เมื่อยืนยัน platform support แล้ว GHCR private ต้องตั้ง pull access ฝั่ง Nortezh แยกจาก `GITHUB_TOKEN` ของ Actions

Build/test ใช้ `contents: read` และไม่รับ Nortezh/DB/FCM/API credentials ให้ `packages: write` เฉพาะ caller delivery job ไม่ใช้ `secrets: inherit` Nortezh secrets อ่านเฉพาะ environment jobs ห้ามส่ง DB/FCM keys เข้า Docker build/ARG/image/artifact

## 3. Protected environments และ operator preflight ก่อน GHCR push

| App | GitHub environment | Project / location | Deployment / type / port |
|---|---|---|---|
| API | `notify-api-production` | `internal-tools` / `olufy-0` | `notify-alarm-api` / `WebService` / `8787` |
| Web | `notify-web-production` | `internal-tools` / `olufy-0` | `notify-alarm-web` / `WebService` / `3010` |

จำกัด environment deployment branch ให้ตรง `main`; required reviewers เป็นนโยบายของทีม ไม่ได้เพิ่มให้เอง ถ้าตั้ง reviewer จะพักรออนุมัติที่ environment jobs (preflight และ deploy อาจต้องอนุมัติสองครั้ง) หากต้องการ unattended delivery ให้ใช้ branch protection/CI และไม่ตั้ง reviewer gate ราย run อย่าถือว่าชื่อ environment ถูกเท่ากับมี approval (GitHub อาจสร้าง environment เปล่าจากชื่อที่สะกดผิด) ผู้ดูแลต้องตรวจ target ที่เตรียมไว้จริงใน Nortezh UI/API เพราะ action สร้าง revision อาจสร้าง deployment ที่ไม่ตั้งค่าหากชื่อผิด ห้ามเดาหรือเติม suffix ให้ target

ตั้ง variables/secrets **แยกในแต่ละ environment**:

| ชื่อ | ประเภท / เงื่อนไข |
|---|---|
| `NTZ_PROJECT`, `NTZ_LOCATION` | Variables: `internal-tools`, `olufy-0` |
| `NTZ_DEPLOYMENT`, `NTZ_TYPE`, `NTZ_PORT` | Variables: ตรงแถว API/Web ข้างบน; preflight ตรวจ exact target/type/port ก่อน GHCR push |
| `NTZ_EXISTING_TARGET_CONFIRMED` | Variable `true` **หลัง operator ตรวจ existing prepared target จริง** ไม่ตั้งเพื่อข้าม guard |
| `NTZ_RUNTIME_READY` | Variable `true` **หลัง operator อนุมัติ runtime configuration** ของ app นั้น เป็น attestation ไม่ใช่ health proof |
| `NTZ_WEB_ACCESS_PROTECTED` | Web-only variable `true` หลังตั้งและตรวจ authenticated ingress/private access **แยกจาก source app** ไม่ใช่การเพิ่ม login หรืออนุมัติ public access |
| `NTZ_SA_EMAIL`, `NTZ_SA_KEY` | Environment Secrets ของ Nortezh service account; action รับ `SA_AUTH_EMAIL`/`SA_AUTH_KEY` ไม่ใส่ใน repo/chat/build jobs |

Source guard → protected environment approval → target/runtime/access preflight **ก่อน GHCR push** เป็น fail-closed boundary ถ้าค่าว่าง/ผิด/ยังไม่อนุมัติให้หยุดก่อนเผยแพร่ Attestation ไม่แทนการตรวจ live target, ingress หรือ readiness จริง

## 4. API runtime บน Nortezh (ไม่ใช่ build secrets)

- `DATABASE_URL`: PostgreSQL ภายนอก **UTF8** ใช้ TLS ตรวจ hostname/CA และสิทธิ์ migration ที่เหมาะสม Go ตรวจ encoding และ auto-migrate ก่อนเปิด listener; migration `backend/migrations/001_init.sql` ฝัง binary ด้วย `go:embed` ไม่ต้อง copy SQL แยก ไม่ใช้ embedded demo เป็น production
- ทบทวน schema/backup/rollback **ก่อน** revision ใหม่เริ่ม เพราะ startup เขียน schema จริง ไม่มี staging DB และ migration ปัจจุบันไม่ใช่ versioned rollback runner ห้ามยิง DDL/synthetic alert ใส่ข้อมูลจริงโดยไม่มีอนุมัติ
- `ALERT_API_KEY`: random key อย่างน้อย 32 bytes เก็บ platform Secret สำหรับ caller ไม่ฝัง APK/browser
- `FCM_DEVICE_TOKEN` และ `GOOGLE_APPLICATION_CREDENTIALS`: ตั้ง token ปัจจุบันและ **path ของ service-account JSON ที่ platform mount เป็น secret file อ่านได้โดย UID 65532** ไม่ใช่ raw JSON env/ไฟล์ใน image หากไม่มี secure mount ให้หยุดตกลงทางเลือก ไม่เปิดไฟล์แบบ world-readable
- `HOST=0.0.0.0`, `PORT=8787`: route WebService ไปพอร์ตเดียวกัน ตั้ง resources/health checks ฝั่ง platform
- `ACK_PUBLIC_BASE_URL`: operator ต้องตั้ง HTTPS URL ที่ Pixel เข้าถึงได้จริงผ่าน TLS/reverse proxy Go API ตรวจ routing/Ack แยก ปิด Authorization/body/access logs ที่อาจรั่ว capability ไม่เปิด HTTP listener ตรงสู่ internet

**ห้ามส่ง DB credentials/connection string ที่มีรหัสผ่าน, service-account JSON, FCM token หรือ API key ใน chat/commit** ใช้ secret manager ที่อนุมัติ การตั้ง env ไม่เท่ากับ Go→FCM→Pixel→HTTPS Ack ผ่านแล้ว หลักฐาน Pixel เดิมเป็น Node→FCM→local Ack

## 5. Web runtime และ access ที่ยังคงเดิม

WebService port 3010 ใช้ `BACKEND_URL` ของ Go API แบบ HTTPS สำหรับ non-loopback และ `BACKEND_API_KEY_FILE` หรือ `BACKEND_API_KEY` **server-only runtime** ไม่ใช้ `NEXT_PUBLIC_*`/build ARG ไม่ส่ง key ให้ browser ตรวจ mount อ่านได้โดย user `node` ตาม [คู่มือ backoffice](backoffice-build-th.md)

Source ยังคง read-only **loopback-Host BFF** ไม่มี login เพิ่ม ไม่ขยาย Host/Origin gate เพื่อ deploy Public/LAN/default external Host ยังถูกปฏิเสธ 403; bind `0.0.0.0` ใน container ไม่ใช่ authentication ต้องตั้ง authenticated ingress/private access อิสระก่อนยืนยัน `NTZ_WEB_ACCESS_PROTECTED=true` และตรวจการทำงานกับ Host/Origin policy จริง ไม่ถือว่ามี proxy แล้ว UI public-ready และไม่ใช้ header rewrite แทน authentication

## 6. Operator checklist และหลักฐาน

1. ตรวจ project/location/existing targets, ports/type, protected environments/reviewers และ GHCR pull access จริงก่อนตั้ง vars ยืนยัน
2. อนุมัติ API DB/migration/backup/FCM mount/HTTPS Ack และ Web HTTPS backend/server-only key/access protection แยก ตั้ง runtime-ready เฉพาะหลังตรวจครบ
3. หลัง configuration ถูกรวมเข้า `main` โดยขั้นตอน Git ที่อนุญาตแล้ว ตรวจ tests/dockerize/artifact → preflight → publish digest → exact-tag Nortezh revision ของแต่ละ app ไม่ต้องเปิด release template เพิ่ม
4. ตรวจ revision/image digest, logs ที่ไม่รั่ว secret, `/health`, DB connection/migration, HTTPS ingress และ Web access/403; action สร้าง revision สำเร็จไม่เท่ากับบริการพร้อม
5. ทดสอบ synthetic alert→Pixel→human Ack→Go/PostgreSQL เฉพาะเมื่อได้รับอนุมัติและมือถือดังได้ ตรวจ retry เดิมไม่นับ human action ซ้ำ dashboard ใช้ DB เดียวกัน เตรียม rollback ที่รองรับ schema จริงก่อน deploy ถัดไป

**สถานะหลักฐาน:** main CI รุ่นก่อนแบบ build-only เคยผ่านแล้ว แต่ configuration main-delivery ใหม่นี้ **ยังไม่ได้รันบน GitHub** และงานนี้ **ยังไม่ publish image/deploy live** ยังไม่ยืนยัน existing targets/runtime/public URL/Go HTTPS Ack/Web authenticated access บน Nortezh การตรวจไฟล์ในเครื่องหรือผล CI เดิมไม่ใช่ deployment verification
