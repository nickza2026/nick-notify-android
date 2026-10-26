# ประวัติการแจ้งเตือน — Go + Firestore + Next.js

> เอกสาร baseline ประวัติการพัฒนาเท่านั้น ผู้ใช้ยืนยันเปลี่ยนกลับ PostgreSQL วันที่ 20 ต.ค. 2026 ดู [คู่มือปัจจุบัน](dashboard-local-th.md) ไม่ต้องสร้าง Firestore database/deploy indexes ตามเอกสารรุ่นนี้

## ขอบเขตปัจจุบัน

ผู้ใช้ยืนยันเปลี่ยน PostgreSQL เป็น Cloud Firestore โดยเริ่มจาก **Firestore Emulator ในเครื่อง** เท่านั้น ไม่สร้าง database บน cloud, ไม่เปิด billing, ไม่ deploy rules/indexes/IAM, ไม่ย้ายข้อมูลจริง และไม่ส่ง FCM จริงในการทดสอบ

Go และ HTTP contract เดิมยังอยู่ Dashboard เป็น Next.js ภาษาไทยแบบอ่านอย่างเดียว ส่วน Android ยังหยุดเสียงด้วยปุ่มรับทราบในเครื่องได้โดยไม่รอ server/อินเทอร์เน็ต TTL เป็นกำหนดเริ่มเสียง ไม่ใช่เวลาหยุดเสียง และตู้กลับ ON ไม่ได้ auto-Ack

**ข้อมูลจำลองไม่ใช่ประวัติจริง:** demo มี 6 alerts, 2 alerts รับทราบแล้ว, action ต่อแถวรวม 3 แต่ action ภาพรวมเท่ากับ 2 เพราะการกด Ack-all ครั้งเดียวผูกสอง alerts การส่งซ้ำด้วย UUID เดิมไม่ใช่การกดใหม่ `provider_accepted` ของ demo เป็นผลจาก fake sender ไม่ใช่หลักฐานว่าโทรศัพท์ได้รับหรือดัง

## 1. เริ่มในเครื่อง (สาม terminal)

เครื่องนี้ตรวจแล้วว่าใช้ Node 22.19.0, pnpm 10.33.0, Firebase CLI 15.34.0 และ Android Studio JBR Java 21.0.6 ได้ ใช้ CLI แบบ local ไม่ติดตั้ง global และไม่ต้อง login Firebase เพื่อรัน demo project

### Terminal A — Firestore Emulator

ติดตั้ง tooling ครั้งแรก:

```powershell
Set-Location D:\works\notify-android\tools\firebase-cli
pnpm install --frozen-lockfile --ignore-scripts
```

เริ่ม emulator:

```powershell
Set-Location D:\works\notify-android\firestore
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:PATH=$env:JAVA_HOME+'\bin;'+$env:PATH
$env:JAVA_TOOL_OPTIONS='-Xms64m -Xmx512m'
node ..\tools\firebase-cli\node_modules\firebase-tools\lib\bin\firebase.js emulators:start --only firestore --project demo-notify-alarm --config firebase.json --non-interactive
```

หากติดตั้ง Java ที่อื่น ให้ปรับ `JAVA_HOME` เป็น Java 21 ที่ตรวจ version แล้ว Config bind เฉพาะ `127.0.0.1`: Firestore 8085, hub 4405, logging 4505, websocket 9150; emulator UI ปิดอยู่ ไม่แก้ firewall/router/VPN

`demo-*` ไม่มี Firebase project จริง ใช้ emulator เท่านั้น ข้อมูลเป็น local/disposable ไม่ใช่ cloud backup ไม่มีการ import/export อัตโนมัติ ปิดด้วย Ctrl+C ใน terminal ที่เริ่ม emulator

### Terminal B — Go synthetic API

```powershell
Set-Location D:\works\notify-android\backend
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8085'
$env:FIRESTORE_PROJECT_ID='demo-notify-alarm'
go run ./cmd/dev --synthetic --port=8793
```

`FIRESTORE_EMULATOR_HOST` **ไม่มี** `http://` Backend ปฏิเสธ host ที่ไม่ใช่ loopback และ project ที่ไม่ขึ้นต้น `demo-` ใน emulator mode โดยไม่อ่าน credential จริง `cmd/dev` ใช้ fake sender, namespace ใหม่ทุกครั้ง และไม่ลบ/overwrite namespace ที่มีอยู่ กด Ctrl+C เพื่อหยุด API หรือใช้ `--stop-file=<path ที่ยังไม่มี>` แล้วสร้างไฟล์นั้นเพื่อ graceful shutdown

### Terminal C — Next dashboard

```powershell
Set-Location D:\works\notify-android\dashboard
Copy-Item .env.example .env.local  # ครั้งแรกเท่านั้น ห้าม overwrite config ของระบบจริง
pnpm install
pnpm dev
```

เปิด **http://127.0.0.1:3010** และตรวจแถบ “ข้อมูลสาธิต — ไม่ใช่ประวัติการส่งจริง” ตัวอย่าง env ใช้ key สังเคราะห์ที่ตรงกับ Go demo default ไม่ใช่ production secret หาก override `ALERT_API_KEY` ต้องใช้ค่าเดียวกันที่ Next ผ่าน `BACKEND_API_KEY_FILE` (มีลำดับก่อน) หรือ `BACKEND_API_KEY`

API key อยู่ฝั่ง Next server เท่านั้น ไม่ใช้ `NEXT_PUBLIC_`, ไม่ส่งเข้า browser ไม่มีปุ่มส่งแจ้งเตือนหรือปุ่ม Ack ใน dashboard Host/origin guard + bind localhost ยังไม่ใช่ระบบ login สำหรับเปิดใช้งานภายนอก

## 2. Firestore ไม่มี SQL auto-migrate

ไม่มีตาราง/ALTER TABLE แบบ PostgreSQL แล้ว Collections/documents ถูกสร้างเมื่อ write เกิดขึ้นเท่านั้น ไม่ได้สร้าง Cloud Firestore database, billing หรือ indexes ให้อัตโนมัติ

Production ใช้ `notify_alerts/{alert_id}` และ `notify_idempotency/{SHA256(idempotency_key)}` เก็บเฉพาะ hash ของ capability/idempotency key ไม่เก็บ plaintext token/API key รายละเอียด action, จำนวนและ canonical Ack อยู่ใน alert document เดียว ทำให้ GET ได้ snapshot ที่ตรงกัน

`firestore/firestore.indexes.json` เตรียม composite indexes ของ `notify_alerts` สำหรับ:

- `status ASC, created_at DESC, __name__ DESC`
- `has_ack ASC, created_at DESC, __name__ DESC`
- `status ASC, has_ack ASC, created_at DESC, __name__ DESC`

**ยังไม่ deploy** Emulator ไม่บังคับ composite indexes แบบ production จึงห้ามอ้างว่าทดสอบ emulator ผ่านแล้วแปลว่า cloud indexes พร้อม Rules file ปฏิเสธ direct client read/write ทั้งหมด; Go server SDK ใช้ IAM และ bypass Security Rules จึงต้องกำหนด least-privilege IAM แยกเมื่อจะใช้จริง

PostgreSQL source เดิมเก็บใน `artifacts/postgres-source-baseline.zip` ไม่มีข้อมูลฐานจริง/credential ใน archive ไม่มีงาน backfill หรือแปลงประวัติจาก Node/PostgreSQL ไป Firestore โดยอัตโนมัติ ไม่สร้างเวลารับทราบย้อนหลังจากการคาดว่าเสียงหยุด

## 3. Idempotency และความหมายของ Ack

- transaction จอง alert + idempotency record ก่อนเรียก provider และ **ไม่ส่ง FCM ใน transaction callback** ซึ่ง SDK อาจ retry หลายครั้ง
- body เดิม/key เดิม replay ผลเดิม; body เปลี่ยนหรือ ID ขัดแย้งเป็น 409; reservation ที่ค้างหลัง crash ไม่ส่งซ้ำเองและยังเป็น `delivery_unknown`
- UUID `client_action_id` หนึ่งตัวต่อการกด Ack-all หนึ่งครั้ง ใช้ตัวเดิมข้าม alerts ในชุดและ HTTP retries
- action ซ้ำไม่เพิ่ม `ack_count`; UUID ใหม่เพิ่มได้ แต่ `acknowledged_at` แรกไม่เปลี่ยน แม้ clock ของ action ใหม่ย้อนหลัง
- `ack_action_count` ภาพรวมนับ UUID ไม่ซ้ำใน alerts ที่เข้าเงื่อนไข ไม่ใช่บวก `ack_count` ทุกแถว และไม่ใช่การยืนยันตัวบุคคล
- ACK transaction บันทึก action/counters/first/last atomically แล้วจึงตอบรับ `expires_at` ไม่ทำให้ capability หมดสิทธิ์ Ack
- ข้อมูล provider และ Ack แยกกัน `status` คง `provider_accepted|provider_failed|delivery_unknown`; ได้ Ack แล้วไม่เปลี่ยน outcome เดิม
- Firestore timestamp มี precision ระดับ microsecond; server normalize ก่อน commit/ตอบ เพื่อให้ response แรกและ retry มี canonical timestamp ตรงกัน
- transient storage failure ต้องเป็น 503 ที่ retry ได้ ไม่ใช่ 401 ซึ่งจะทำให้ client เข้าใจว่า capability ผิดถาวร

## 4. HTTP/FE reference

Browser เรียกเฉพาะ Next BFF GET `/api/history`, `/api/stats`, `/api/alerts/{id}` แล้ว BFF เติม application Bearer key ไป Go ไม่ตาม redirect จำกัด upstream 1 MiB และ project เฉพาะ DTO ที่ตรวจแล้ว ไม่ forward capability/hash/credential fields ส่วนเกิน

| Go endpoint | สิทธิ์ | ความหมาย |
|---|---|---|
| `GET /v1/history` | application Bearer | รายการและ keyset cursor |
| `GET /v1/stats` | application Bearer | ผล provider/จำนวน alerts/UUID action ไม่ซ้ำ |
| `GET /v1/alerts/{id}` | application Bearer | summary + action timeline |
| `POST /v1/alerts/{id}/ack` | per-alert capability เท่านั้น | รายงานการรับทราบแบบ retry-safe |

History query: `from` inclusive, `to` exclusive RFC3339, `status=all|provider_accepted|provider_failed|delivery_unknown|acknowledged|pending_ack`, `limit` 1–100 (UI ใช้ 25), `cursor` opaque ผูกกับ filters เดิม เรียง `created_at DESC, document ID DESC` ไม่ใช้ OFFSET

Summary fields: `alert_id,title,message,status,created_at,provider_accepted_at,expires_at,acknowledged_at,ack_count,last_ack_at`

Detail เพิ่ม `acknowledged`, `delivery_verified:false` และ `ack_actions:[{client_action_id,client_acked_at,received_at}]` แม้ไม่มี Ack ต้องเป็น `[]` ไม่ใช่ null Stats fields: `total_alerts,provider_accepted,provider_failed,delivery_unknown,acknowledged,pending_ack,ack_action_count`

API ใช้ UTC `Z`; UI แสดง Asia/Bangkok UTC+7/พ.ศ. ช่อง date HTML ใช้ปี ค.ศ. ของ browser เช่น 2026-10-19 ตัวกรองรวมวันสุดท้ายที่เลือก โดยใช้ถึงเที่ยงคืนถัดไปแบบ exclusive กรอง **เวลาสร้าง alert** ไม่ใช่เวลา Ack การ์ดสรุปใช้ช่วงวันที่ ไม่ใช้ status filter ของตาราง

`received_at` เป็นเวลา server; `client_acked_at` เป็น telemetry นาฬิกาเครื่องอาจคลาดเคลื่อน Provider acceptance ไม่ยืนยันถึงเครื่อง/เสียง `null` แสดงไม่ทราบ ไม่แทนด้วย 0; API error ไม่ fallback เป็นข้อมูล demo เงียบ ๆ ถ้า refresh ล้มเหลวให้คงข้อมูลเดิมพร้อมป้ายว่าอาจไม่เป็นปัจจุบัน

Errors สำคัญ: 400 query/schema, 401 credential/capability ผิด, 404 ไม่พบ, 409 conflict/ผลส่งยังค้างไม่แน่นอน, 413/415/422 validation, 429 quota/concurrency, 502 ผลส่ง failed/unknown, 503 Firestore unavailable/scan limit/action capacity ไม่แสดง raw upstream error ต่อ browser

## 5. โควตาและต้นทุน

Firestore Spark มี free quota ตาม [เอกสารทางการ](https://firebase.google.com/docs/firestore/quotas): 1 GiB, 50,000 reads/day, 20,000 writes/day, 20,000 deletes/day, outbound 10 GiB/month และหนึ่ง free database ต่อ project ต้องตรวจ plan ของ project จริงก่อน ไม่ใช่สัญญาว่าจะฟรีไม่จำกัด หากเป็น Blaze อยู่แล้วอาจมีค่าบริการ

Stats ปัจจุบัน scan projected alert documents เพื่อ deduplicate UUID อย่างถูกต้อง ไม่ใช่ SQL COUNT DISTINCT หรือ sum รายวัน มีเพดาน 5,000 alerts / 20,000 actions ต่อคำขอ เกินแล้ว 503 `scan_limit_exceeded` ไม่คืนยอดบางส่วนที่ดูเหมือนครบ ต่อ alert จำกัด 4,000 actions และ Firestore มี 1 MiB/document ซึ่งอาจปฏิเสธก่อนถึงเพดาน

Projection ไม่ทำให้ document read ฟรี และ aggregate count ก็มีค่า read ตาม index entries ([pricing](https://firebase.google.com/docs/firestore/pricing)) Dashboard ไม่มี auto-poll/stream listener จึงไม่เปิด browser ทิ้งแล้วอ่านทุกวินาที การ retry ที่ไม่เพิ่มจำนวน action ยังมี read cost ได้

ก่อนเปิด API ภายนอกต้องมี rate/admission limit ที่ reverse proxy **ก่อนถึง Firestore**: cap lookup เกิดก่อน coarse invalid quota ใน process จึงยังเกิด read cost จาก token ที่รูปแบบถูกแต่ไม่มีสิทธิ์ได้ ยังไม่ได้อ้างว่า production abuse protection พร้อม

## 6. ทดสอบและ deployment artifacts

```powershell
Set-Location D:\works\notify-android\backend
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8085'
$env:FIRESTORE_PROJECT_ID='demo-notify-alarm'
go test ./... -count=3 -timeout=3m -v
go vet ./...
Set-Location ..\dashboard
pnpm test
pnpm typecheck
pnpm build
```

Tests สร้าง `demo-test-*` project แยกใน emulator ไม่ wipe ทั้ง emulator และไม่แตะ namespace ที่มีอยู่ Missing/unreachable emulator เป็น failure ไม่ skip `go test ./... -run '^TestPure' -count=1` เป็น offline protocol/FCM test เท่านั้น ไม่แทน integration

Browser smoke `scripts/test-dashboard-cdp.mjs` ใช้ dedicated headless CDP profile port 9223 (ไม่ใช่ browser ปกติ), `DASHBOARD_ORIGIN` สำหรับ Next และ `DASHBOARD_API_ORIGIN` สำหรับ Go default 8793 ใช้ช่วงวันที่แสดงจริงครอบคลุม yesterday/today เพื่อไม่พังเมื่อ fixture ข้ามเที่ยงคืน Bangkok ผล screenshot/DOM ไม่ใช่ human visual acceptance

Go image ใช้ `docker build -f Dockerfile.go -t notify-alarm-go:local .` Runtime ไม่รวม emulator/credential/data/source backup Kubernetes ตัวอย่าง `deploy/k8s/go-deployment.yaml.example` เปลี่ยนจาก `DATABASE_URL` เป็น `FIRESTORE_PROJECT_ID` กับ credential mount ไม่มีการ apply ตัวอย่างนี้หรือแก้ Node deployment เดิม

Production ยังต้องเลือก/create database, ตรวจ plan/region/IAM, deploy indexes/rules หลังอนุมัติ และกำหนด HTTPS URL ที่มือถือเข้าถึง จึงยังไม่อ้างว่า Pixel Ack→Go/Firestore จริงผ่านแล้ว ไม่ย้าย sender Node ที่ใช้อยู่ไป Go หรือย้ายข้อมูลจริงเอง
