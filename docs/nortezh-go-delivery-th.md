# Deploy API / Web ไป Nortezh ตาม Nick Skills

## 1. โครงสร้าง workflow ใหม่

อ้างอิง Nick Skills commit `4a70d2fa56ad0257b0f728fa594e86da468d8f6f` (`4a70d2f`): แต่ละ app ใช้ **standalone full workflow สอง jobs เท่านั้น `dockerize_n_push → deploy`** ไม่มี reusable/caller หรือ jobs เพิ่ม ปรับตามนโยบายโปรเจกต์: **main → production เท่านั้น ไม่มี staging/release และไม่รัน PR** ไม่ย้าย Dockerfiles หรือเพิ่ม Swagger

| ไฟล์ | หน้าที่ |
|---|---|
| `.github/workflows/api-production.yaml` | API: `dockerize_n_push → deploy`; main push ตาม Go/Docker/workflow paths หรือ manual branch build |
| `.github/workflows/web-production.yaml` | Web: `dockerize_n_push → deploy`; main push ตาม dashboard/workflow paths หรือ manual branch build |
| `.github/workflows/android-apk.yaml` | คงเดิม: manual-only; signed APK job เฉพาะ main และ signer validation เดิม |

Path filters รวม source/Docker dependencies ของ app, workflow ของตน, `tools/test-standalone-nortezh.mjs`, `docs/deployment/nortezh-workflows.json` และไฟล์สกิลที่ใช้จริงสองไฟล์เท่านั้น: `.skills/deploying-go-to-nortezh/scripts/render-workflows.mjs` กับ `.skills/deploying-go-to-nortezh/assets/workflow-service.yaml.tmpl` การแก้ docs/skills อื่นไม่ trigger ยกเว้นอยู่ใน `dashboard/**` ไม่มี PR, topic-branch push หรือ tag trigger

`docs/deployment/nortezh-workflows.json` เป็น **reviewed-template adaptation** บันทึกข้อตกลงที่ตรวจทานแล้ว ไม่ใช่ portable renderer input ที่ใช้ได้ตรง ๆ: มี `context`, `githubEnvironment`, `policy` และ Docker paths จริงต่างจาก `build/<app>/Dockerfile` ของ renderer อย่าใช้ CLI `--apply` กับ manifest นี้โดยตรง Helper ของโปรเจกต์คือ `tools/test-standalone-nortezh.mjs`; layout/helper รุ่นก่อนถูกแทนที่แล้ว

ถ้า branch protection เดิมบังคับ PR status checks ที่ไม่รันแล้ว ผู้ดูแลต้องปรับ required checks ให้สอดคล้องกับนโยบาย no-PR-CI นี้ มิฉะนั้น PR อาจรอ check ค้าง งานนี้ไม่แก้ GitHub branch protection เอง

Manual run รับเฉพาะ branch ทำ **tests/build/load เท่านั้น** แม้เลือก main ก็ไม่ login/push GHCR และไม่ deploy (`push: false`, `load: true`) ส่วน main push ใช้ push/load output เดียวกันและไม่ cancel in-flight main deployment เมื่อมี push ถัดมา Concurrency ไม่รับประกันลำดับโปรโมชั่นตามเวลา ต้องตรวจ revision ที่ active จริงก่อน rollout/rollback

## 2. ลำดับงานและ image identity

1. **`dockerize_n_push`** — checkout exact `github.sha` และ `persist-credentials: false`; ตรวจ event/revision แล้วรัน workflow contract tests ด้วย Node 22.23.4 และ application tests **ก่อน login/build-push**
   - API: Go จาก `backend/go.mod`, gofmt/build/vet/tests ใช้ embedded PostgreSQL แยก ไม่ใช้ production credentials
   - Web: pnpm 10.33.0, frozen install, Next typegen/typecheck/tests/build
2. คง action/order หลักตาม template พร้อม compatibility override หกรายการที่ผู้ใช้อนุมัติ: `actions/checkout@v4` → `docker/setup-qemu-action@v3` → `docker/setup-buildx-action@v3` → `docker/login-action@v3` → `ASzc/change-string-case-action@v6` → `docker/build-push-action@v6` → `Nortezh/nortezh-action@v1.0.5` (action สุดท้ายอยู่ deploy) เหล่านี้เป็น version tags **ไม่ใช่ SHA-pinned versions**; steps ทดสอบที่เพิ่มอยู่ก่อน login
3. Build `linux/amd64` พร้อม Buildx GHA cache; API ใช้ context `.`/root `Dockerfile.go`; Web ใช้ context `./dashboard`/`./dashboard/Dockerfile` Login และ push เฉพาะ main push; build-push **build, push และ load output เดียวกัน** ไม่ export image tar หรือ Actions image artifact (APK artifacts คงเดิม)
4. หลัง build+push ก่อนส่ง outputs/deploy: API inspect user `65532:65532`; Web ตรวจ user `node` และ smoke แบบ bounded ที่ `127.0.0.1:3010` โดยตั้ง canonical loopback URL เฉพาะ test ตรวจ `/login` สำเร็จ, protected read/send ที่ไม่มี session ได้ 401 และ foreign Host ได้ 403 ไม่ใช้ backend/provider credentials **หาก smoke ล้ม image อาจอยู่ใน GHCR แล้ว แต่ deploy ถูกบล็อก** ไม่ใช่ pre-publication gate
5. ส่ง `image_name=ghcr.io/<owner>/<repo>/notify-<api|web>:<short SHA>` โดย SHA มาจาก `git rev-parse --short HEAD` และบันทึก published digest ใน step summary Tag นี้ mutable/เขียนทับได้ มีความเสี่ยง short-SHA collision ไม่ใช่ full-SHA/run-ID tag หรือ immutable identity
6. **`deploy`** — `needs: dockerize_n_push`, เฉพาะ main push เข้า environment ของ app ตรวจชื่อ secrets ที่ขาดแล้วเรียก `deployment.create-revision` ด้วย exact short-tag `needs.dockerize_n_push.outputs.image_name` ไม่ได้ deploy ด้วย digest และไม่รับประกัน readiness

Job แรกมี `contents: read`, `packages: write`, `attestations: write` ตาม template (permissions ไม่ใช่หลักฐานว่าได้สร้าง attestation) ใช้ built-in `GITHUB_TOKEN` สำหรับ GHCR ส่วน deploy มี `permissions: {}` Nortezh service-account secrets ใช้เฉพาะ deploy job ไม่ส่ง DB/FCM/dashboard API key เข้า tests หรือ Docker build

## 3. GitHub Environments และค่าที่ต้องตั้ง

ผู้ดูแลตั้ง repository → **Settings → Environments** และกำหนด reviewers/deployment branch policy ตาม production approval ที่ต้องการ การมีชื่อ environment ใน YAML ไม่ได้พิสูจน์ว่ามี protection rules แล้ว งานแก้ workflow นี้ไม่ตั้งค่าหรือใส่ secrets บน GitHub เอง

| ค่า | ตำแหน่ง | `notify-api-production` | `notify-web-production` |
|---|---|---|---|
| project | inline YAML | `internal-tools` | `internal-tools` |
| location | inline YAML | `olufy-0` | `olufy-0` |
| name | inline YAML | `notify-alarm-api` | `notify-alarm-web` |
| type | inline YAML | `WebService` | `WebService` |
| port | inline YAML | `8787` | `3010` |
| `NTZ_SA_EMAIL` | Secret | service-account email ที่ได้รับอนุมัติ | service-account email ที่ได้รับอนุมัติ |
| `NTZ_SA_KEY` | Secret | service-account key ที่ได้รับอนุมัติ | service-account key ที่ได้รับอนุมัติ |

ต้อง provision **Secrets สองชื่อเท่านั้น** `NTZ_SA_EMAIL`, `NTZ_SA_KEY` ในแต่ละ environment ไม่ต้องตั้ง NTZ Variables ห้ารายการอีกแล้วเพราะ targets/constants อยู่ inline YAML Workflow ส่ง secrets เป็น `SA_AUTH_EMAIL` / `SA_AUTH_KEY` ให้ Nortezh action ไม่ใส่ค่าจริงใน source, logs, Docker args หรือแชต Built-in `GITHUB_TOKEN` ไม่ใช่ user secret ที่ต้อง provision

**ไม่มี custom readiness flags หรือ approve-target job แล้ว** ใช้ configuration ตามสกิลแทน ค่าพวกนี้ไม่ได้ตรวจ runtime ได้จริงอยู่แล้ว การถอด flags ไม่ใช่การอนุมัติให้ข้ามการเตรียม target/database/authentication

ตรวจเฉพาะ secrets ที่ขาดใน `deploy` **หลัง publish/smoke** ดังนั้น image อาจอยู่ใน GHCR แล้วแม้ deploy หยุดเพราะ secrets ไม่ครบ ไม่มีการเรียก Nortezh เมื่อ validation ไม่ผ่าน ไม่ fallback ไป target อื่น

ตัวอย่าง error ใหม่:

```text
Secret NTZ_SA_KEY is missing in environment notify-api-production.
```

รายงานเฉพาะชื่อ Secret ที่ขาด ไม่แสดงค่า email/key การผ่าน validation ไม่พิสูจน์ว่า credentials authenticate ได้หรือ target พร้อมให้บริการ

## 4. เตรียม Nortezh runtime ก่อนเปิด delivery

ตรวจ existing targets/project/location/ports ให้ตรง หรือขออนุมัติสร้าง target ก่อนเปิด production run เพราะ `deployment.create-revision` อาจสร้าง deployment เมื่อชื่อยังไม่มี ห้ามใช้ pipeline เป็นวิธีเดาสร้าง service/ตั้ง runtime แทน operator

ตั้ง GHCR pull access ของ Nortezh แยกสำหรับ private image: GitHub login/push สำเร็จไม่ได้ให้สิทธิ์ดึง image แก่ Nortezh โดยอัตโนมัติ รวมถึงตรวจ resources, replica/scale policy, network, TLS, health checks และ rollback

### API

- Container ใช้ `HOST=0.0.0.0`, `PORT=8787`; PostgreSQL เป็น external UTF-8 database ไม่ใช้ embedded test cluster ใน production
- ตั้ง `DATABASE_URL`, `ALERT_API_KEY`, selected FCM credential file/mount, `GOOGLE_APPLICATION_CREDENTIALS`, `FCM_DEVICE_TOKEN` และ HTTPS `ACK_PUBLIC_BASE_URL` ตาม runtime contract ไม่ใส่ค่าจริงใน workflow รุ่น dashboard login เพิ่ม `DASHBOARD_ADMIN_USERNAME` / private `DASHBOARD_BOOTSTRAP_PASSWORD` สำหรับสร้างผู้ดูแลหนึ่งบัญชีครั้งแรก ดู [runtime guide](dashboard-runtime-th.md)
- Go startup ทำ schema migration ต้องกำหนด migration ownership/backup และตรวจความเข้ากันได้กับ binary เก่าก่อน rollout ไม่เชื่อมฐานจริงหรือย้ายข้อมูลโดยอนุมานสิทธิ์จากการแก้ YAML
- Key ของ caller อยู่ฝั่ง server เท่านั้น ดู request/error/idempotency/Ack ใน [integration guide](service-integration-th.md)

### Web

- Container ใช้ `HOSTNAME=0.0.0.0`, `PORT=3010`; ตั้ง HTTPS `BACKEND_URL` และ `BACKEND_API_KEY_FILE` (หรือ `BACKEND_API_KEY` เป็นตัวเลือกสำรอง) ฝั่ง server ตาม [คู่มือ dashboard](dashboard-local-th.md) ห้ามใช้ `NEXT_PUBLIC_*` สำหรับ API key
- รุ่นนี้เพิ่ม login และบังคับเปลี่ยนรหัสครั้งแรก ก่อนอ่านประวัติหรือส่งทดสอบ ต่างจากรุ่นเดิมที่ใช้ loopback-only guard ต้องตั้ง canonical HTTPS `DASHBOARD_PUBLIC_URL` และ preserve public `Host` ให้ตรง ไม่เชื่อ arbitrary forwarded headers ห้ามเปิด anonymous bypass
- การ bind 0.0.0.0 ไม่ใช่ authentication; ต้องตรวจ cookie/Host/Origin/CSRF และ proxy behavior จริงแยกหลังได้รับอนุมัติ rollout หาก API ใช้ internal HTTP ตั้ง exact origin ผ่าน `BACKEND_ALLOWED_HTTP_ORIGINS` ดู [runtime guide](dashboard-runtime-th.md) และ [FE contract](fe-dashboard-auth-th.md)

## 5. ตรวจหลัง rollout และหลักฐานที่มี

หลังได้รับอนุมัติและมี run จริง ให้ตรวจ tests/build/push/load/smoke, GHCR tag/digest, Nortezh revision ที่ active และ image pull/startup/logs/health/runtime ของแต่ละแอป การสร้าง revision สำเร็จไม่ใช่ health หรือ Pixel-delivery proof

ทดสอบ synthetic alert → Pixel → human Ack → Go/PostgreSQL/HTTPS เฉพาะเมื่อได้รับอนุมัติ ใช้ incident/action ID เดิมตลอด retry และเทียบประวัติจริง ไม่ auto-Ack เมื่อตู้กลับ ON

**หลักฐานของรุ่นเก่า:** main `86fbc4f` มี [API run 40633786607](https://github.com/nickza2026/nick-notify-android/actions/runs/40633786607) และ [Web run 40633786594](https://github.com/nickza2026/nick-notify-android/actions/runs/40633786594) ผ่าน tests/Docker build; Web ผ่าน Linux container smoke แต่ทั้งคู่หยุดที่ `approve-target` จึงไม่ publish/deploy ข้อความ generic exit 1 ไม่ชี้ว่าค่าใดผิด และไม่ใช่ Nortezh action ปฏิเสธงาน

ผลตรวจวันที่ 29 ต.ค. 2026: หลังปรับ approved action versions แล้ว `node --test tools/test-standalone-nortezh.mjs` ผ่าน 10 tests และ actionlint 1.7.12 ผ่านทั้ง API/Web/APK โดยไม่ปิดกฎ obsolete-runtime (optional shellcheck/pyflakes ไม่ได้รัน) Renderer/Docker example tests ของ skill snapshot เดิมผ่าน 25 tests รวม compiler-only synthetic Go → Linux ELF ไม่ใช่การรัน Swagger generator หรือ Docker

ก่อนแก้ actionlint พบ obsolete-runtime 10 จุด และตรวจ official action.yml เพิ่มพบ lowercase action ใช้ Node 16 เช่นกัน ผู้ใช้อนุมัติวันที่ 29 ต.ค. 2026 ให้เปลี่ยนเฉพาะหก versions เป็น Node 20 ตามลำดับข้างต้นแล้ว ส่วน Nortezh `v1.0.5` คงเดิม บันทึก `actionVersionOverrides` ใน manifest และให้ project regression ตรวจเฉพาะ allowlist นี้ ไม่แก้ installed skill/template/golden fixtures หรือเปลี่ยนโครงสอง jobs การเปลี่ยน action runtime ไม่เปลี่ยน Node 22.23.4 ของ application และการผ่าน lint ไม่ใช่หลักฐานว่า GitHub/platform รันสำเร็จจริง

Docker Linux engine ยังไม่พร้อม จึงยังไม่ได้ build/smoke image รุ่นนี้ในเครื่อง และยังไม่ได้ push/รัน GitHub workflows/publish image/deploy จริง ไม่มี provider acceptance, live runtime หรือ Pixel → Go HTTPS Ack assurance จากงานนี้
