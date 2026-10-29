# Dashboard สำหรับใช้งานผ่านเครือข่าย — แผนร่าง

สถานะ: ผู้ใช้ยืนยันวันที่ 29 ต.ค. 2026 ว่าใช้ผู้ดูแลหนึ่งบัญชี ไม่มี public signup เริ่ม implementation บนฐานข้อมูล/ตัวส่งจำลองที่แยกในเครื่องแล้ว ไม่ใช่การอนุมัติ production rollout หรือ visual acceptance

## สิ่งที่ผู้ใช้ขอ

1. เปิด Web จากภายนอกได้หลัง login และบังคับเปลี่ยนรหัสผ่านครั้งแรก
2. ส่งแจ้งเตือนทดสอบไปแอป พร้อมประวัติว่ามีรายงานการกดรับทราบกลับมาหรือยัง
3. เลือกแจ้งเตือนเงียบหรือวิกฤตได้
4. ปรับ Web UI ให้ทันสมัย รองรับ dark mode และหน้าจอมือถือ พร้อมตรวจแนวทางจากแหล่งอ้างอิงจริง

## สิ่งที่ตรวจพบแล้ว

- ข้อความ localhost-only เป็น guard ของ Web เดิม ไม่ใช่ login การถอดอย่างเดียวจะเปิดข้อมูลที่ BFF อ่านด้วย server-held API key ให้คนภายนอก
- API/Android รองรับ `importance: normal` และ `critical` แล้ว Normal ใช้ notification เงียบ ไม่สั่น และต้องไม่หยุด critical ที่กำลังดัง
- มีประวัติ provider outcome, Ack count, เวลา server รับ Ack, เวลา client รายงาน และ action ID อยู่แล้ว ไม่ต้องสร้างประวัติอีกชุดตามหน้าจอ
- FCM รับคำขอไม่ใช่หลักฐานว่ามือถือรับข้อความหรือส่งเสียง ไม่มีรายงาน Ack ก็ไม่ได้พิสูจน์ว่าคนยังไม่กด เพราะมือถืออาจออฟไลน์
- ผู้กดรับทราบบนมือถือหยุดเสียงภายในเครื่องก่อน ไม่รอ backend; HTTP retry ต้องใช้ `client_action_id` เดิม และไม่เพิ่มจำนวนการกด
- Main `8292355` เป็น merge ของงาน workflow ก่อนหน้า Tree ตรงกับ `484c999`; งานใหม่นี้อยู่ branch `feat/dashboard-auth-and-alert-console`

## ขอบเขตที่นำไปพัฒนา

- ผู้ใช้ยืนยันบัญชีผู้ดูแลหนึ่งบัญชี ไม่มี public signup; หลาย tenant และระบบลืมรหัสผ่านผ่านอีเมลอยู่นอก scope รอบนี้
- ตั้ง credential เริ่มต้นผ่าน private runtime Secret ไม่ใช้รหัส hardcoded และไม่ให้ผู้เข้าเว็บคนแรกยึดสิทธิ์ผู้ดูแล
- Login ด้วย credential เริ่มต้นได้เพียง session จำกัดสิทธิ์ จนกว่าจะตั้งรหัสใหม่สำเร็จ จึงอ่านประวัติหรือส่งทดสอบได้
- ส่งทดสอบไปอุปกรณ์ที่ server ตั้งค่าไว้ ไม่เปิดให้กรอก FCM token หรือปลายทาง arbitrary จาก browser
- ฟอร์มทดสอบเริ่มแบบเงียบโดยส่ง `importance: normal` ชัดเจน; แบบ critical ต้องเลือกและยืนยันคำเตือนเสียงต่อเนื่องจนกดรับทราบ TTL ไม่ใช่เวลาหยุดเสียง
- Web แบบ dark-first มีทางเลือก light/system ใช้ stack Next/React/CSS เดิม ไม่เพิ่ม UI library เพียงเพื่อเปลี่ยนหน้าตา

## ขอบเขตความปลอดภัยที่ต้องรักษา

- ใช้ Go/PostgreSQL เป็น authoritative store ของบัญชีและ session; ออกแบบ schema/diagram หลังยืนยันขอบเขตบัญชี ไม่แก้ migration `001` ที่อาจใช้งานแล้ว
- รหัสผ่านเก็บเป็น salted password hash เท่านั้น Session ใช้ random opaque token เก็บ hash ฝั่ง server พร้อมหมดอายุและ revoke ได้
- เปลี่ยนรหัสแล้วต้อง invalidate session เก่า และห้าม bypass สถานะบังคับเปลี่ยนรหัสด้วยการเรียก API ตรง
- ใช้ HttpOnly/Secure/SameSite cookie และตรวจ public origin/CSRF สำหรับ mutation ไม่เชื่อ arbitrary Host หรือ forwarded headers โดยไม่มี trust policy
- Login ต้องมีขนาด input/อัตราการลอง/งาน hash ที่จำกัด ไม่บันทึก password/cookie/API key/Ack capability ลง log
- ไม่เปิด CORS แบบ credentialed wildcard และไม่สร้าง proxy ที่รับ URL/method arbitrary
- หากต้องใช้ internal HTTP ให้จำกัด hostname/port ที่ operator ตั้งไว้โดยชัดเจน ไม่ปล่อย HTTP ทุก host
- Browser ไม่มีปุ่มปลอม Ack; แสดงเฉพาะรายงาน capability Ack ที่ server ได้รับ ไม่อ้างชื่อบุคคล/เครื่องเมื่อไม่มี identity ดังกล่าว

## แนว UI ที่เตรียมไว้

- Navigation กะทัดรัด: ประวัติ / ส่งทดสอบ พร้อม account/logout/theme controls
- Summary แยก provider กับ Ack; ตารางที่อ่านเร็ว และ mobile cards ที่ไม่ซ่อนข้อมูลสำคัญ
- รายละเอียดเป็น timeline แยกเวลา server กับ client พร้อมสถานะกำลังโหลด/ว่าง/ผิดพลาด/ข้อมูลเก่า/หมด session
- Pagination ใช้ `next_cursor` ตาม API เดิม ไม่สร้างยอดรวมจำนวนหน้าที่ไม่มีใน contract
- ไม่แสดงกราฟหรือตัวเลขสาธิตเป็นผลส่งจริง ไม่ถือการปัดหรือเปิด notification ว่าเป็นการกดรับทราบ
- ตรวจเอกสารทางการผ่าน HTTP สำเร็จทั้งสี่แหล่งด้านล่างแล้ว เป็นการอ่านเนื้อหา ไม่ใช่การดู rendered UI หรือหลักฐานความนิยมเชิงสถิติ ยังไม่ได้วัด contrast หรือผ่าน visual acceptance

### แหล่งอ้างอิงที่อ่านจริง

- [shadcn/ui Sidebar](https://ui.shadcn.com/docs/components/sidebar): แนว navigation ที่ composable/themeable และย่อเป็น icon rail ได้ นำแนวมาปรับกับ layout เดิม ไม่ได้ติดตั้ง component library
- [shadcn/ui Dark mode สำหรับ Next.js](https://ui.shadcn.com/docs/dark-mode/next): แยก theme provider/control และรองรับ system preference เป็นแนวทางออกแบบ ไม่ได้รันคำสั่งติดตั้ง `next-themes`
- [Radix Colors — Use cases](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale): แยกสี background, interactive surface, border/focus และระดับ contrast ของข้อความ ไม่ใช้สีเดียวแสดงทุกสถานะ
- [Next.js Authentication](https://nextjs.org/docs/app/guides/authentication): แยก authentication, session management และ authorization; การซ่อน UI ไม่ใช่การป้องกัน API/data

ทิศทางที่แนะนำ: calm dark-first operations dashboard, navigation rail กะทัดรัด, card/table surfaces แยกระดับ, ข้อมูลสถานะเป็นศูนย์กลางแทนกราฟตกแต่ง ใช้ Next/React/CSS เดิม โดย visual/product acceptance ยังเป็นของผู้ใช้

## แผนตรวจเมื่อเริ่ม implementation

- Regression สำหรับ unauthenticated/force-change session, password change, expiry/logout/revocation, trusted origin/CSRF และ bounded login hashing
- ทดสอบการสร้าง alert แบบ idempotent, timeout/unknown outcome, normal/critical และ Ack retry โดยใช้ synthetic sender
- ใช้ PostgreSQL ชั่วคราวที่แยกจาก production ตรวจ upgrade migration โดยรักษาประวัติเดิม
- ตรวจ browser desktop/mobile, dark/light/system, keyboard/focus, loading/error/empty states และข้อความเตือน critical จริง
- ไม่ส่งแจ้งเตือนไปมือถือจริง ไม่ใช้ฐานจริง ไม่ publish/merge/deploy ใน scope การพัฒนารอบนี้ การทดสอบเสียง/FCM จริงต้องได้รับอนุมัติแยก
