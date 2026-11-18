# Google owner login — สัญญา API สำหรับ FE

Dashboard เป็น browser client แบบ same-origin; ไม่มี public signup และไม่มีการให้สิทธิ์ owner ตาม Google email/ผู้ใช้คนแรก เอกสารนี้อธิบายเฉพาะ wire contract ที่ client เห็น; รายละเอียดการตั้งค่าอยู่นอกเอกสารนี้. ตัวอย่าง token ทุกจุดเป็น **placeholder สังเคราะห์ ไม่ใช่ JWT/token ใช้งานได้จริง**.

## เส้นทางที่ได้รับผลกระทบ

| Method/path | สถานะ | ฝั่งที่เรียก / สิ่งที่เปลี่ยน |
|---|---|---|
| `GET /api/auth/google-setup` | ใหม่ | Browser ไม่ต้องมี local session; รับ public Firebase Web config เพื่อดู UID ของบัญชีที่ตนเลือกก่อนเปิด owner login; ไม่เรียก backend exchange |
| `GET /api/auth/config` | ใหม่ | Browser ไม่ต้องมี session; ตรวจ auth mode และ Web Firebase project ก่อนส่ง login; ไม่มี fallback password เมื่อ config ล้มเหลว |
| `POST /api/auth/google-login` | ใหม่ | Browser แลก **Firebase ID token** เพื่อรับ local HttpOnly session |
| `POST /api/auth/login`, `POST /api/auth/change-password` | เปลี่ยน | เมื่อ `mode=google` หรือ owner เคยผูก Google แล้ว password auth ตอบ `403 password_auth_disabled`; ไม่ส่งรหัสผ่านลองซ้ำ |
| `GET /api/auth/session`, `POST /api/auth/logout` | เปลี่ยนเงื่อนไขพร้อมใช้งาน | ใช้ local cookie เดิม; Google config ไม่พร้อมอาจตอบ `503 google_auth_unavailable`; DTO สำเร็จเดิม |
| `GET /api/history`, `GET /api/stats`, `GET /api/alerts/{id}`, `POST /api/test-alerts`, `GET /api/devices`, `DELETE /api/devices/{id}` | เปลี่ยนเงื่อนไขพร้อมใช้งาน | ใช้ local full session เดิม; Google config ไม่พร้อมอาจตอบ `503 google_auth_unavailable`; query/body/success DTO เดิม ไม่ต้องส่ง Firebase token ทุกคำขอ |
| `GET /v1/client/auth-config`, `POST /v1/client/google-login` | ใหม่ | Android เรียก public API ผ่าน base HTTPS ที่ตั้งไว้; ไม่ใช้ app master key |
| `POST /v1/client/login`, `POST /v1/client/change-password`, `GET /v1/client/session`, `POST /v1/client/logout`, `GET /v1/client/keys`, `GET /v1/client/devices`, `POST /v1/client/devices/register` | เปลี่ยนเงื่อนไขพร้อมใช้งาน | Password paths ถูกปิดดังกล่าว; protected routes อาจตอบ `503 google_auth_unavailable` เมื่อ config เสีย; DTO อื่นเดิม |
| `GET /v1/dashboard/auth-config`, `POST /v1/dashboard/google-login` | ใหม่ **BFF ภายในเท่านั้น** | ต้องใช้ application key; browser/Android ห้ามเรียก Go Dashboard route ตรงหรือรับ master key |
| `POST /v1/dashboard/login`, `POST /v1/dashboard/change-password`, `GET /v1/dashboard/session`, `POST /v1/dashboard/logout`, `GET /v1/dashboard/history`, `GET /v1/dashboard/stats`, `POST /v1/dashboard/alerts`, `GET /v1/dashboard/alerts/{id}`, `GET /v1/dashboard/devices`, `DELETE /v1/dashboard/devices/{id}` | เปลี่ยนเฉพาะ auth eligibility | BFF ภายในเท่านั้น; client ใช้ `/api/*` ข้างต้น |

## กฎร่วมของ client

Browser ใช้ same-origin `fetch` พร้อม cookie; mutation ส่ง `Origin` ที่ตรง canonical Web origin, `Content-Type: application/json` และ `X-Notify-Request: dashboard` (header นี้ไม่ใช่ key). BFF ตรวจ Host และ Origin; host/origin ผิดตอบ `403 invalid_origin`. การอ่าน config ทั้งสอง path ไม่ต้อง cookie, ไม่มี query/body; อย่าส่ง Firebase ID token ใน URL/log/storage. Browser **ไม่เห็น** local `session_token`; BFF ตั้ง host-only `__Host-notify_session` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`) บน HTTPS, หรือ `notify_session_local` แบบไม่ Secure เฉพาะ explicit loopback HTTP. Android เก็บ `access_token` เป็น opaque bearer สำหรับ client routes ตามสัญญา shared-device เดิม; ไม่ใช้ Web cookie. Google SDK popup เริ่มจาก user action; browser Firebase Auth ใช้ in-memory persistence และ sign out หลังการแลก/ตรวจ UID. Android เรียก Firebase signOut ใน flow แต่ไม่รับประกันว่า Firebase Auth ไม่มี persisted state หาก process ตายกลางทาง.

Success auth `expires_at` เป็น UTC RFC3339 timestamp โดยส่วนทศนิยมวินาทีอาจมีถึง 9 หลัก; `user.username` เป็น **legacy alias** ของ owner ไม่ใช่ Google email หรือ UID; `user.must_change_password` เป็น `false` สำหรับ Google login. Local web session absolute 24 ชม.; native login session ต่อ installation อายุ 30 วันและต่ออายุด้วยการ register สำเร็จ. Google/Firebase sign-out หรือ disable account ไม่เพิกถอน local session ที่ออกไปแล้วโดยอัตโนมัติ. การ retry login หลัง timeout **ไม่ใช่ idempotent**: อาจออก session ใหม่และ rotate token ของ native installation เดิม; installation ID ยังคงเดิม.

Browser error เป็น `{ "code": "<code>", "error": "<ข้อความภาษาไทย>" }` ไม่มี raw provider response; ใช้ `code`/HTTP status ไม่ใช้ข้อความตัดสิน. ตัวอย่าง:

```json
{"code":"google_account_not_allowed","error":"บัญชี Google นี้ไม่ได้รับอนุญาต"}
```

Go public Android error ต่างจาก BFF: `{ "error": { "code": "<code>" }, "request_id": "<UUID>" }`; ตัวอย่าง (request ID สังเคราะห์):

```json
{"error":{"code":"invalid_google_credentials"},"request_id":"00000000-0000-4000-8000-000000000000"}
```

`429 rate_limited` มี `Retry-After` วินาที (`60` สำหรับ rate window; `1` เมื่อ concurrent เต็ม); หยุด/รอ ไม่ loop retry. Client และ Dashboard Go ใช้ admission ร่วม 120 คำขอที่รับ/นาที, invalid app key Dashboard 60/นาที, concurrency 2; BFF ส่ง `Retry-After` ที่เป็นตัวเลขต่อให้ browser. ปัญหาเครือข่าย/502 ไม่พิสูจน์ว่า login ไม่สำเร็จ; ตรวจ session ก่อนลองใหม่. `503 google_auth_unavailable` แปลว่า config/binding ไม่พร้อม ไม่ใช่คำเชิญให้ fallback password. Session หมดอายุ `401 session_required`; protected routes ยังอาจให้ `403 password_change_required` สำหรับ session เก่าที่ restricted อยู่ก่อน cutover.

## GET /api/auth/google-setup — ตรวจ Firebase UID ก่อน cutover

ไม่ต้องมี Go backend, application key, owner row หรือ local session; ไม่มี query/body และไม่ผูกบัญชี. ใช้ public Web Firebase configuration เท่านั้น:

```http
GET /api/auth/google-setup
```

`200`:

```json
{"firebase":{"apiKey":"SYNTHETIC_PUBLIC_WEB_API_KEY","authDomain":"example-project.firebaseapp.com","projectId":"example-project","appId":"1:1234567890:web:abcdef1234"}}
```

`firebase` เป็น object มี `apiKey`, `authDomain`, `projectId`, `appId` (string ไม่ว่าง) เท่านั้น; ค่าเหล่านี้เป็น **public client config ตัวอย่าง** ไม่ใช่ backend key. ผู้ใช้เลือก Google account ผ่าน SDK แล้วอ่าน Firebase `user.uid` ที่ SDK คืน; route นี้ **ไม่คืน UID**, ไม่รับ token/UID และไม่แลกเป็น Notify session. Firebase SDK sign-in ครั้งแรกอาจสร้าง Firebase Authentication user ใน project แต่ไม่สร้าง Notify owner. Error ที่เกี่ยวข้อง: `400 invalid_schema` เมื่อมี query, `403 invalid_origin` สำหรับ origin/host ไม่ตรง, `503 server_configuration` เมื่อ Web config ไม่ครบ/ไม่ถูกต้อง.

ข้อจำกัด public Web config: ทุก string ยาว 1–256 UTF-16 code units และไม่มี whitespace/control character; `projectId` เป็นอักษรเล็ก/ตัวเลข/ขีดกลาง 6–30 ตัว เริ่มด้วยอักษรและจบด้วยอักษรหรือตัวเลข. `authDomain` เป็น DNS hostname ไม่เกิน 253 ตัว ไม่มี scheme, port, path, query หรือ user info. Object ไม่มี field `owner_uid`, backend key หรือ client secret.

## GET /api/auth/config และ GET /v1/client/auth-config

ทั้งสองเส้นทางไม่มี query/body; Browser เรียก `/api/auth/config` ส่วน Android เรียก `/v1/client/auth-config` แบบ public. ใช้ `mode` จาก server เท่านั้น:

```http
GET /api/auth/config
```

`200` ใน Google mode:

```json
{"mode":"google","firebase_project_id":"example-project","firebase":{"apiKey":"SYNTHETIC_PUBLIC_WEB_API_KEY","authDomain":"example-project.firebaseapp.com","projectId":"example-project","appId":"1:1234567890:web:abcdef1234"}}
```

`200` ใน password mode: `{"mode":"password","firebase_project_id":null,"firebase":null}`. `mode` มีเพียง `password|google`; `firebase_project_id` เป็น string project ID เมื่อ Google หรือ `null` เมื่อ password; `firebase` ของ Web เป็น object สี่ string ตาม section ก่อนหรือ `null` ตาม mode. BFF ต้องตรวจ `firebase.projectId === firebase_project_id` ก่อนตอบ Google config; mismatch → `503 server_configuration` (FE ไม่เสนอ password fallback). Android `200` ต่างตรง **ไม่มี** key `firebase`: ตัวอย่าง `{"mode":"google","firebase_project_id":"example-project"}` หรือ `{"mode":"password","firebase_project_id":null}`; ตรวจ project ที่ APK ตั้งไว้ตรง server ก่อนเริ่ม Google login. Errors Web: `400 invalid_schema` (query), `403 invalid_origin`, `503 google_auth_unavailable|server_configuration`, `502 upstream_error`; Android: `503 google_auth_unavailable`, `429 rate_limited`. ถ้า config อ่านไม่ได้ ให้หยุด login ทั้งสองชนิด ไม่เดา mode.

## POST /api/auth/google-login — browser

ใช้หลัง SDK ได้ **Firebase ID token** ของผู้ใช้ที่เลือกแล้ว (ไม่ใช่ Google OAuth ID/access token). Same-origin mutation ตามกฎร่วม; ไม่ส่ง `uid`, email, alias หรือ `installation_id`:

```http
POST /api/auth/google-login
Content-Type: application/json
X-Notify-Request: dashboard

{"id_token":"SYNTHETIC.HEADER.PAYLOAD"}
```

ตัวอย่าง dotted placeholder นี้จงใจไม่ใช่ JWT ที่ตรวจลายเซ็นผ่าน. Body เป็น object **หนึ่ง key** `id_token: string` เท่านั้น; BFF รับ JSON สูงสุด 16384 bytes, token ยาวไม่เกิน 8192 ตัวอักษร ASCII รูปสามช่วง base64url คั่นจุด; Go จำกัด token สูงสุด 8192 UTF-8 bytes และตรวจ token จริงด้วย Firebase SDK. BFF ปฏิเสธ key เพิ่ม/ชนิดผิด `400 invalid_schema`; Go ปฏิเสธ token ว่าง/ยาวเกิน `422 invalid_id_token`. `200` ตั้ง cookie และคืน **เฉพาะ**:

```json
{"user":{"username":"admin","must_change_password":false},"expires_at":"2026-11-18T03:00:00Z"}
```

`user` เป็น object สอง field ตามกฎร่วม; `expires_at` string UTC. ไม่คืน `session_token`, Firebase token หรือ Google profile. Errors: `400 invalid_schema`, `401 invalid_google_credentials` (รวม token invalid/หมดอายุ/ตรวจ certificate ไม่สำเร็จ), `403 google_account_not_allowed` (UID ไม่ตรง owner), `403 google_auth_disabled` (password mode), `403 invalid_origin`, `429 rate_limited`, `503 google_auth_unavailable|server_configuration`, `502 upstream_error`. BFF ส่ง provider error ที่รู้จักเป็น code ไม่แสดง raw provider body; หาก backend result ผิด schema ให้ `502 upstream_error`. ไม่แยกสาเหตุ Firebase ด้วยการเดา error string.

## POST /v1/client/google-login — Android

ส่ง JSON `Content-Type: application/json` หลัง Android Credential Manager ได้ Google ID token แล้ว Firebase Auth แลกเป็น **Firebase ID token**; ไม่มี application key/Google token ใน Authorization สำหรับ login. ใช้ installation UUID แบบ canonical lowercase รูป `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` ที่คงเดิม:

```http
POST /v1/client/google-login
Content-Type: application/json

{"id_token":"SYNTHETIC.HEADER.PAYLOAD","installation_id":"00000000-0000-4000-8000-000000000001"}
```

`id_token` เป็น string Firebase ID token สูงสุด 8192 UTF-8 bytes; `installation_id` เป็น string canonical UUID; ห้ามส่ง UID/email เพิ่ม. Go รับ JSON body ไม่เกิน 16384 bytes. `200`:

```json
{"access_token":"SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS","expires_at":"2026-12-18T03:00:00Z","user":{"username":"admin","must_change_password":false}}
```

`access_token` จริงเป็น opaque base64url 43 ตัวอักษร (ตัวอย่างข้างบนไม่ใช่ token จริง), `expires_at` เป็น UTC RFC3339; `user` ตามกฎร่วม. ต่อจากนี้ใช้ `Authorization: Bearer <access_token>` กับ client session/register/keys/devices ตาม contract เดิม. Errors Go: `400 invalid_schema` (รวม object ผิด/unknown field/null), `415 json_required`, `413 body_too_large`, `422 invalid_id_token|invalid_installation_id`, `401 invalid_google_credentials`, `403 google_account_not_allowed|google_auth_disabled`, `429 rate_limited`, `503 google_auth_unavailable`. ไม่ถือ Google login สำเร็จว่า device ลงทะเบียนรับแจ้งเตือนแล้ว.

| Field | ชนิด / required / null | เงื่อนไข |
|---|---|---|
| `id_token` ใน body | string, required, ไม่รับ null | ค่าว่างหรือเกินขอบเขตตอบ `422 invalid_id_token` ที่ Go; BFF ตรวจรูป JWT และตอบ `400 invalid_schema`; Go ตอบ `400 invalid_schema` สำหรับ null |
| `installation_id` ใน native body | string, required, ไม่รับ null | ขาด/ผิด UUID ตอบ `422 invalid_installation_id`; null ตอบ `400 invalid_schema`; browser ไม่รับ field นี้ |
| `user` ใน success | object, required, ไม่รับ null | มี `username: string` และ `must_change_password: boolean` ตามกฎร่วม |
| `expires_at` ใน success | string, required, ไม่รับ null | เวลาหมดอายุของ local session ไม่ใช่เวลาหมดอายุ Firebase token |
| `access_token` ใน native success | string, required, ไม่รับ null | เป็น credential ของ installation; browser success ไม่มี field นี้ |

หากอ่าน body ขาดตอน Go อาจตอบ `400 request_interrupted`; ความผิดพลาดบริการ/ฐานข้อมูลที่ไม่ใช่ผลยืนยัน Google อาจตอบ `503 temporarily_unavailable`. Error ทั้งสองใช้ Go error envelope เดิม; BFF แปลงความผิดพลาดการรับ upstream เป็น `502 upstream_error` หรือส่ง code ที่รู้จักโดยไม่ส่ง raw response.

## Password เดิมและ protected routes

`POST /api/auth/login` ใช้ JSON `{username,password}`; native `/v1/client/login` เพิ่ม `installation_id` UUID เดิม. `POST /api/auth/change-password` และ native `/v1/client/change-password` ใช้ JSON `{current_password,new_password}` พร้อม local cookie/bearer ตาม client. ทุก field เป็น string required ไม่รับ null; ชื่อยาวไม่เกิน 64 bytes, รหัสเดิม/รหัส login ไม่เกิน 128 UTF-8 bytes, รหัสใหม่อย่างน้อย 15 Unicode code points และไม่เกิน 128 UTF-8 bytes. Browser รับ body สูงสุด 4096 bytes; native สูงสุด 16384 bytes. ไม่มี field Google เพิ่มใน request เดิม.

ใน password mode ที่ไม่เคยผูก Google: success `200` ใช้ auth response แบบเดียวกับตัวอย่างด้านบน แต่ `must_change_password` อาจเป็น `true` สำหรับ login ที่ยัง restricted; browser ตั้ง cookie ส่วน native คืน `access_token`. Change-password สำเร็จคืน token/cookie ใหม่และ `must_change_password:false`. **พฤติกรรมที่เปลี่ยนสำหรับคำขอผ่าน validation**: เมื่อเข้าสู่ Google mode หรือเคยผูก Google owner แล้ว password login/change ตอบ `403 password_auth_disabled` ไม่ออก local token แม้รหัสตรง. หาก Google mode ยังผูก/ตรวจ config ไม่ได้ อาจตอบ `503 google_auth_unavailable` ก่อนตรวจรหัส. การ reset รหัสผ่านไม่เปิด password auth ของ owner ที่ผูก Google.

หลัง login สำเร็จ browser `/api/auth/session` คืน `{"user":{"username":"admin","must_change_password":false},"expires_at":"2026-11-19T03:00:00Z"}` โดยไม่มี token; `/api/auth/logout` ส่ง mutation ไม่มี body ที่จำเป็นและคืน `{"ok":true}` พร้อมล้าง cookie เมื่อสำเร็จ (กรณี backend ปฏิเสธก็ล้าง cookie); Android `/v1/client/session` คืน `user`/`expires_at` แบบเดิม และ logout ของ Android มีผลต่ออุปกรณ์ด้วย ไม่ใช่การ revoke เฉพาะ Firebase. Protected data routes ในตาราง inventory ไม่เปลี่ยน request/response ปกติ แต่เมื่อเลือก Google mode และ config ใช้งานไม่ได้ ทุก path อาจตอบ `503 google_auth_unavailable` ก่อน session/data handling. First bind เพิกถอน session เดิมหนึ่งครั้ง; restart ด้วย binding ที่ตรงไม่เพิกถอนซ้ำ.
