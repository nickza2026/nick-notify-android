# Dashboard ประวัติการแจ้งเตือน — Go/PostgreSQL + Next.js

> การเปลี่ยนแปลงรุ่น Web login: จากหน้าอ่านอย่างเดียว/localhost-only เป็นผู้ดูแลหนึ่งบัญชีพร้อมบังคับเปลี่ยนรหัสครั้งแรก และมีหน้าส่งทดสอบ ดู [runtime ใหม่](dashboard-runtime-th.md) และ [browser contract](fe-dashboard-auth-th.md) ขั้นตอนสอง terminal ด้านล่างเป็น baseline demo เดิม ต้องเพิ่ม private bootstrap ของ API และ `DASHBOARD_PUBLIC_URL` ฝั่ง Web ก่อนใช้รุ่นใหม่ ไม่ถือ env demo เป็นบัญชี login

> ผู้ใช้ยืนยันกลับมาใช้ PostgreSQL วันที่ 20 ต.ค. 2026 ใช้ Go + PostgreSQL ที่ผู้ใช้จัดหา ทดสอบเบื้องต้นด้วย embedded PostgreSQL ก่อน ไม่เชื่อมฐานข้อมูลจริงหรือ deploy อัตโนมัติ ดู [service integration](service-integration-th.md) สำหรับ API ส่งแจ้งเตือน

## 1. ขอบเขตและสิ่งที่ต้องไม่เข้าใจผิด

งานนี้เพิ่ม backend Go และประวัติใน PostgreSQL แยกจาก Node PoC เดิม พร้อม dashboard ภาษาไทยแบบอ่านอย่างเดียว ทดสอบเบื้องต้นในเครื่อง ไม่ deploy หรือเปิด port สู่ภายนอก

- ประวัติเก็บเวลาสร้าง alert, เวลาที่ provider รับคำขอ, ผลที่ทราบ/ไม่แน่นอน, เวลา server รับ Ack, เวลาอุปกรณ์รายงาน และจำนวน action ที่ไม่ซ้ำ
- ตาราง การ์ดมือถือ และรายละเอียดแสดง `importance`: **ธรรมดา · เงียบ** (`normal`) หรือ **วิกฤต · ปลุก** (`critical`) แยกจากผล provider ประวัติเก่าที่ไม่มี field อ่านเป็น critical ส่วนค่าที่ผิด/null ไม่ถูกแสดงเป็นระดับอื่นโดยเดาเอง
- `provider_accepted` ไม่ยืนยันว่าถึง Pixel หรือดังแล้ว แม้มี Ack ก็ไม่ยืนยันตัวบุคคล เป็น action ที่ client รายงานด้วย capability ที่ถูกต้อง
- TTL คือกำหนดเริ่มเสียงล่าสุด ไม่ใช่เวลาหยุดเสียง เมื่อเริ่มแล้วต้องกดรับทราบเอง; ตู้กลับ ON ไม่ได้แปลว่าคนรับทราบ
- Node history/การกดบนมือถือก่อนมี route ไม่ถูกนำเข้าย้อนหลังเอง ไม่สร้างเวลารับทราบจากการคาดว่าเสียงหยุด
- embedded PostgreSQL ใช้เฉพาะ tests และ `cmd/dev --synthetic` เท่านั้น ข้อมูล demo ถูกลบเมื่อหยุดแบบ graceful; production ใช้ PostgreSQL ภายนอกที่มี persistence/backup ของผู้ให้บริการ API pod ไม่เก็บ ledger ใน PVC ของตัวเอง
- ต้องใช้ database UTF8: embedded demo ระบุตอน initdb ไม่รับค่า WIN874 ตาม Windows locale ส่วน production ตรวจ encoding ก่อน auto-migrate และไม่แปลงฐานเดิมเอง

## 2. เริ่ม demo ด้วยสอง terminal

ต้องมี Go 1.25+, Node 22.19+ และ pnpm เส้นทางตัวอย่างเป็น repo root `D:\works\notify-android`

Terminal แรก:

```powershell
Set-Location D:\works\notify-android\backend
go run ./cmd/dev --synthetic
```

API ฟังเฉพาะ `127.0.0.1:8791` เริ่ม embedded PostgreSQL ด้วย temporary data/runtime และ port loopback ของตัวเอง มี 6 เหตุการณ์จำลอง ไม่มี Firebase credentials และไม่ส่ง FCM จริง `--synthetic` ต้องระบุชัด หยุดด้วย Ctrl+C แล้วรอ process จบเพื่อปิด DB/ลบ temp directory

Terminal ที่สอง:

```powershell
Set-Location D:\works\notify-android\dashboard
Copy-Item .env.example .env.local  # ทำครั้งแรกเมื่อยังไม่มี .env.local เท่านั้น
pnpm install
pnpm dev
```

เปิด **http://127.0.0.1:3010** แถบเหลืองต้องแสดง “ข้อมูลสาธิต — ไม่ใช่ประวัติการส่งจริง” `.env.example` ใช้ key จำลองที่ตรงกับ `cmd/dev` default ไม่ใช่รหัสของระบบจริง อย่า overwrite `.env.local` ที่มีการตั้งค่าจริงอยู่แล้ว และอย่าเปิด demo ต่อเครือข่ายภายนอก

หากตั้ง `ALERT_API_KEY` ให้ Go demo เอง ต้องใช้ค่าเดียวกันใน `BACKEND_API_KEY_FILE` หรือ `BACKEND_API_KEY` ฝั่ง Next โดยไฟล์มีลำดับก่อน environment key ห้ามใช้ `NEXT_PUBLIC_` และไม่ใส่ key ลง browser หรือ request ฝั่ง client หน้าเว็บไม่มีช่องกรอก key และไม่มีปุ่มส่ง/รับทราบ

## 3. ความหมายของจำนวนและเวลา

### จำนวน action ไม่ใช่จำนวน HTTP requests

Android สร้าง `client_action_id` UUID หนึ่งตัวต่อการกดรับทราบทั้งหมดที่มี alert active หนึ่งครั้ง ส่ง UUID เดิมให้แต่ละ alert ในชุด และใช้ UUID เดิมเมื่อ retry

- unique `(alert_id, client_action_id)` ทำให้ retry ไม่เพิ่มจำนวนของ alert นั้น
- `ack_action_count` ภาพรวมนับ UUID ที่ไม่ซ้ำข้าม alert; กดครั้งเดียวรับทราบสอง alert ไม่กลายเป็นสองครั้ง
- `ack_count` ต่อแถวเป็นจำนวน action ที่เชื่อมกับ alert นั้น ห้ามบวกทุกแถวเพื่อสรุปจำนวนการกดทั้งหมด
- UUID ใหม่ที่รายงานภายหลังกับ alert เดิมเพิ่ม action ได้ แต่ `acknowledged_at` แรกไม่เลื่อน แม้ server clock ของ action ใหม่ย้อนก่อนเวลาเดิม
- ปุ่มที่ไม่มี alert active ไม่สร้าง action ใหม่ ข้อมูลเก่าที่ไม่มี UUID ใช้ deterministic legacy ID ไม่เปลี่ยนทุก retry

Demo มี 6 alerts, 2 alerts รับทราบแล้ว, ผลรวม action ต่อแถว = 3 แต่ action ภาพรวม = 2 ใช้ตรวจการนับ batch/ซ้ำ ไม่ใช่ประวัติการกดจริง

### เวลา

API เก็บ `timestamptz` และส่ง UTC RFC3339; dashboard แสดง Asia/Bangkok (UTC+7) และ พ.ศ. ช่องเลือกวันที่ HTML ใช้ปี ค.ศ. ตาม calendar ของ browser เช่น `2026-10-19` ผลลัพธ์เวลาแสดง พ.ศ. 2569

- `created_at`: ก่อนส่ง provider
- `provider_accepted_at`: บันทึกหลัง provider ตอบรับเท่านั้น ถ้าไม่มีไม่เดาเวลาขึ้น
- `acknowledged_at`: server receipt แรกแบบ immutable
- `last_ack_at`: timestamp ของ action ล่าสุดตามเวลาที่ server บันทึก
- `ack_actions[].received_at`: เวลา server authoritative สำหรับประวัติ
- `client_acked_at`: telemetry จากนาฬิกาอุปกรณ์ อาจคลาดเคลื่อน ไม่ใช้ยืนยันตัวบุคคลหรือเรียง canonical Ack แรก

ตัวกรองวันที่รวมวันสุดท้ายที่เลือก โดยแปลงเป็น `[from, to)` จากเที่ยงคืน Bangkok ถึงเที่ยงคืนถัดจากวันสุดท้าย กรองตาม **เวลาสร้าง alert** ไม่ใช่เวลา Ack การ์ดสรุปใช้ช่วงวันที่เท่านั้น ไม่ใช้ตัวกรองสถานะของตาราง

## 4. Endpoints / สิทธิ์สำหรับ FE

Browser เรียก Next BFF เฉพาะ GET `/api/history`, `/api/stats`, `/api/alerts/{id}` BFF จึงเติม Bearer application key ที่ server ไป Go ไม่ตาม redirect จำกัด body 1 MiB และ project เฉพาะ DTO ที่ตรวจแล้ว ไม่มี capability/hash/credential หลุดผ่าน field ส่วนเกิน

| Go endpoint | สิทธิ์ | Response ที่ UI ใช้ |
|---|---|---|
| `GET /v1/history` | application Bearer | `items[]`, `next_cursor` |
| `GET /v1/stats` | application Bearer | totals/ผล provider/จำนวน alert ที่ Ack และจำนวน action ไม่ซ้ำ |
| `GET /v1/alerts/{id}` | application Bearer | summary + `ack_actions[]`, `delivery_verified:false` |
| `POST /v1/alerts/{id}/ack` | per-alert capability เท่านั้น | canonical `acknowledged_at`, `ack_count`, `last_ack_at` |

History query: `from` inclusive / `to` exclusive RFC3339, `status=all|provider_accepted|provider_failed|delivery_unknown|acknowledged|pending_ack`, `limit` 1–100 (BFF จำกัด 25), `cursor` opaque ต้องใช้กับ filters เดิม API เรียงใหม่ไปเก่าด้วย `(created_at,id)` ไม่ใช่จัดเรียงเฉพาะหน้าใน browser

History item: `alert_id,title,message,status,created_at,provider_accepted_at,expires_at,acknowledged_at,ack_count,last_ack_at` โดย `status` คงผล provider เสมอ สถานะ Ack แยกต่างหาก `pending_ack` เป็น accepted แต่ยังไม่มี Ack ไม่เปลี่ยนเพราะ TTL หมด

Stats: `total_alerts,provider_accepted,provider_failed,delivery_unknown,acknowledged,pending_ack,ack_action_count` และ action detail: `client_action_id,client_acked_at,received_at` ตัวเลข null/ไม่ทราบไม่แปลงเป็น 0 ถ้า API ล้มเหลวต้องแสดง error ไม่สลับไป demo เงียบ ๆ เมื่อ refresh ล้มเหลวให้คงข้อมูลเดิมพร้อมป้ายว่าอาจไม่เป็นปัจจุบัน

Go errors สำคัญ: 400 schema/query, 401 สิทธิ์ผิด, 404 ไม่พบ, 409 idempotency/ID conflict หรือผลส่งยังไม่แน่นอน, 413/415/422 validation, 429 quota/concurrent limit, 502 provider failed/unknown, 503 DB/config/state unavailable ไม่ใช้ raw error/body จาก upstream แสดงต่อผู้ใช้

## 5. ตรวจสอบและแก้ Maven binary download

```powershell
Set-Location D:\works\notify-android\backend
go test ./... -count=1 -timeout=5m -v
go vet ./...
Set-Location ..\dashboard
pnpm test
pnpm typecheck
pnpm build
```

Go integration tests ใช้ PostgreSQL process จริงในเครื่อง แยก temp data และ fake sender; ไม่ skip เมื่อหา binary ไม่ได้ Archive public ถูก cache ใน `%LOCALAPPDATA%\notify-alarm\embedded-postgres` (override `NOTIFY_PG_CACHE`) แต่ data ไม่ใช่ cache ไม่ติดตั้ง system PostgreSQL

หาก library บอก `no version found matching 16.9.0` ต้องตรวจ HTTP จริงก่อน เพราะอาจเป็น Maven 429 ไม่ใช่ version ไม่มี บน Windows AMD64 ใช้ helper หนึ่งครั้งได้:

```powershell
Set-Location D:\works\notify-android
.\scripts\cache-postgres-windows-amd64.ps1
```

helper ใช้ Windows HTTP กับ Maven official URL ตรวจ SHA-256 manifest ก่อนเผยแพร่ archive ไป cache ไม่เปลี่ยน VPN/proxy/port หรือ execute binary ที่ checksum ไม่ผ่าน หากยัง 429 ให้รอหรือใช้เครือข่ายที่ได้รับอนุมัติ ไม่ยิงซ้ำเป็นวง

`go test ./... -run '^TestPure' -count=1` ตรวจ FCM/protocol แบบ offline ได้ แต่ **ไม่ใช่ตัวแทน integration tests** Browser smoke ใช้ `scripts/test-dashboard-cdp.mjs` กับ CDP browser profile แยก port 9223 และ demo/live-local API ที่รันอยู่ ไม่ใช่ browser ปกติของผู้ใช้

## 6. Docker/Kubernetes และขอบเขตที่ยังต้องตรวจ

Go image: `docker build -f Dockerfile.go -t notify-alarm-go:local .` ใช้ dedicated context allowlist ไม่คัดลอก credential, Android/Firebase config หรือ embedded binary; runtime ต้องใช้ PostgreSQL ภายนอก ไม่มี embedded DB ใน image ตัวอย่าง `deploy/k8s/go-deployment.yaml.example` แยกจาก kustomization Node เดิมและยังไม่ apply ต้องเปลี่ยน image/Secret/DB/TLS/backup ตาม environment จริง

- ยังไม่ย้าย sender ที่รันจริงจาก Node ไป Go หรือ import ประวัติเก่าอัตโนมัติ
- ยังไม่มี production dashboard login/multi-user; bind localhost และ Host/origin guard ไม่ใช่สิทธิ์พร้อมใช้ภายนอก
- Pixel Ack→Go จริงต้องมี HTTPS URL ที่มือถือเข้าถึง พร้อม APK ใหม่ที่มี route/work queue ก่อน จึงไม่อ้างจาก demo ว่าทดสอบบนมือถือแล้ว
- การ์ด/ตาราง/รายละเอียดและการใช้จริงบน desktop/mobile ต้องให้ผู้ใช้ตรวจรับหน้าตาเพิ่มเติม ผล screenshot/DOM smoke ไม่ใช่ human visual approval
