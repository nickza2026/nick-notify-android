# ผลตรวจ Dashboard login / alert console ในเครื่อง

วันที่ 29 ต.ค. 2026 — งานอยู่บน `feat/dashboard-auth-and-alert-console` จากฐาน `8292355` ยังไม่มี commit/push/deploy ของ feature นี้ ข้อมูลทั้งหมดใน browser fixture เป็นสังเคราะห์ ไม่ใช่โทรศัพท์/FCM/ฐาน production

## ผ่านจริง

| Check | ผลที่รัน |
|---|---|
| Backend | `go build ./...`, `go vet ./...`, `go test ./... -count=1 -timeout=8m` ผ่าน; suite ไม่ใช้ cache ใช้เวลา 192.010 วินาที |
| Frontend | `pnpm test` 25/25, `pnpm exec next typegen`, `pnpm typecheck`, `pnpm build` ผ่านบน final CSS snapshot |
| Workflow/artifact tests | 12/12 รวม standalone two-job/trigger/target/version policy และ failed screenshot acquisition ที่ห้ามใช้ไฟล์สำเร็จเก่าซ้ำ |
| Workflow syntax | actionlint 1.7.12 ผ่าน API/Web/APK; ไม่ได้เรียก shellcheck/pyflakes ในการตรวจนี้ |
| Browser | Edge headless โปรไฟล์ใหม่ → loopback TLS termination → Next production standalone → Go → **PostgreSQL 16.9 UTF8 จริง** + synthetic Sender ผ่าน |
| Cleanup | Browser/Node/Go ที่ fixture สร้างปิดแล้ว หยุด PostgreSQL และลบ owned temporary runtime/profile/private fixture credentials สำเร็จ ไม่ลบ cache/ข้อมูลของโครงการอื่น |

Final browser evidence: `artifacts/dashboard-auth-check/2026-10-29T08-00-04-572Z-db34da71/report.json` พร้อม PNG 19 ภาพ มี run ID/เวลา/geometry/contrast และ `passed=true`, `cleanup=true` เป็น ignored local artifacts ไม่ใช่ข้อมูล production

### Browser cases

- Anonymous protected API, forged Host/forwarded Host และ cross-origin login ถูกปฏิเสธ
- Login ครั้งแรกถูกจำกัดสิทธิ์/ไปเปลี่ยนรหัส; restricted session logout ได้; เปลี่ยนรหัส rotate cookie และ revoke session เก่า
- HTTPS cookie เป็น host-only `__Host-notify_session`, Secure, HttpOnly, SameSite=Lax, Path=/; JavaScript ไม่อ่านค่าได้
- Default form ส่ง explicit normal; critical ต้องยืนยัน/cancel ได้ ไม่มีการส่งอัตโนมัติ ไม่มีปุ่มปลอม Ack
- จำลอง **ส่งสำเร็จที่ Go/Sender แต่ client ไม่ได้รับ receipt** แล้วกด retry ใน UI: BFF/Go รับ create สองคำขอ แต่ Sender ถูกเรียกครั้งเดียว
- ส่ง normal/critical ผ่าน real Go reservation และ PostgreSQL; synthetic Sender ไม่เรียก FCM
- จำลองมือถือเรียก capability Ack จริงของ Go ด้วย UUID เดิม: retry ไม่นับซ้ำ และ UUID เดียวครอบคลุมสอง alert นับหนึ่ง action รวม ไม่ได้ทดสอบมือถือจริง
- ภาพ/geometry ที่ 360, 390, 1024, 1440px และ 200%-equivalent reflow ผ่าน ไม่มี root horizontal overflow; ไม่ใช่การรับรอง browser zoom/ทุก DPI/ทุกอุปกรณ์
- Dark/light/system persistence, theme transition settle, native detail-dialog focus/Escape ผ่าน
- Seed history สังเคราะห์เพิ่ม 26 แถวโดยไม่ส่ง provider/สร้าง Ack; cursor request ครั้งแรกได้ 503 กด retry จริงแล้วโหลดครบ 28 แถวด้วยสอง cursor requests ไม่ append ซ้ำ
- Logout revoke cookie เดิม; bootstrap password เดิม login ไม่ได้; password ใหม่ login ได้

### ตัวอย่าง contrast ที่วัดจาก computed style หลัง theme settle

| Theme | Body text | Muted text | Primary label | Input boundary |
|---|---:|---:|---:|---:|
| Dark | 16.42 | 10.22 | 10.38 | 4.08 |
| Light | 14.68 | 6.77 | 6.82 | 3.46 |

เป็น representative checks ไม่ใช่ blanket WCAG/accessibility certification และไม่แทน human visual/product acceptance

## Regression ที่ตรวจพบและแก้

1. **Public login กินโควตา alert/Ack:** reproduce ได้ legacy create ตอบ 429 แทน 202 หลัง login flood แก้ด้วย dashboard admission/rate/concurrency แยกจาก operational routes ทดสอบ login/invalid-cookie/logout flood แล้ว create+capability Ack ยังผ่าน และ legacy quota ยังบังคับตามเดิม Security reviewer ตรวจปิด finding โดย inspection; parent รัน suite จริง
2. **Create receipt หาย field/รับ identity-mode ผิด:** regression เดิม fail จาก field ที่ถูก drop และ malformed receipt ที่ยังตอบ 202 แก้ projection หก field, correlate ID/importance, ไม่ยอมรับ invented Ack/delivery proof
3. **Mobile clipping/desktop overflow:** ภาพจริงขัดกับ assertion เดิม `rootScroll <= innerWidth` เพราะ mobile emulation ขยาย innerWidth ได้ เพิ่มเทียบ requested viewport/element boxes; reproduce root scroll 1630px ที่ viewport 1425px พบ absolute screen-reader label หลุด containing block แก้ containment/reflow โดยไม่ซ่อน document overflow
4. **Pagination error retry ไม่ทำงาน:** แยก phase/ownership ของ next-page request กับ initial/refresh error รักษา cursor/generation และกัน duplicate in-flight รวม browser 503 → retry → recovery จริง
5. **Radio ถูก full-width rule บีบข้อความ:** เพิ่ม real geometry regression พบ radio 456.5px/description หลุด card แก้ selector ให้ยกเว้น radio; final browser วัด **20px ทั้ง desktop/mobile**, description อยู่ใน card และ parent เปิดดู PNG ใหม่แล้ว

## ยังไม่ได้ยืนยัน / ขอบเขตที่ไม่ทำ

- ไม่ส่ง FCM จริง ไม่อ่าน Firebase credential/token จริง ไม่เชื่อม external PostgreSQL และไม่อ้าง Pixel Ack → Go/public HTTPS สำเร็จจาก fixture นี้
- ไม่เปลี่ยน continuous alarm/offline Ack/TTL-stop semantics ของ Android; normal ต้องไม่หยุด critical ที่กำลังดังตาม contract เดิม
- Docker CLI มี แต่ local Docker Desktop Linux engine named pipe ไม่พบ จึง **ยังไม่ build/run image หรือรัน container smoke ในเครื่อง** ไม่ start/repair engine ไม่เปลี่ยน context ไป remote และไม่ publish registry
- Optional Go race detector ยังไม่ผ่าน prerequisite CGO ตามการลองของ backend worker ไม่เปลี่ยน global compiler/runtime config เพื่อข้ามข้อจำกัด; executed integration/concurrency tests ไม่ใช่หลักฐาน `-race` ผ่าน
- ไม่ provision runtime secrets/ingress, migrate ฐานจริง, commit/push หรือ deploy; production ยังต้องตรวจ rollout และ configured Host/TLS/DB/provider จริงภายใต้การอนุมัติแยก
- Human เป็นผู้ยืนยันหน้าตา/การใช้งานสุดท้าย ไม่ใช้ build/test/agent review แทนการยืนยันนั้น

## ทำซ้ำอย่างปลอดภัย

เตรียม dependencies ของ repo ตามคู่มือก่อน จาก repo root:

```powershell
Push-Location dashboard
pnpm test
pnpm exec next typegen
pnpm typecheck
pnpm build
Pop-Location
node tools/check-dashboard-browser.mjs
```

รัน build ให้จบก่อน fixture และ freeze source/build outputs ตลอด run Script ใช้ profile/temp root ใหม่, scrub inherited production credential variables, synthetic Sender เท่านั้น และไม่แก้ global TLS/environment เมื่อใช้ self-signed loopback certificate ไม่ติดตั้ง browser ให้อัตโนมัติ

ตั้ง production ตาม [runtime guide](dashboard-runtime-th.md) หลังได้รับอนุมัติ rollout; [FE handoff](fe-dashboard-auth-th.md) แยกเฉพาะ browser contract และ [DBML](dashboard-auth.dbml) เป็น editable local diagram ไม่ได้ upload ไปบริการภายนอก
