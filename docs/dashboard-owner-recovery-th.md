# กู้บัญชีเจ้าของ Dashboard ด้วยเครื่องมือ operator

เครื่องมือนี้ไม่มี HTTP endpoint, signup, email reset หรือการสร้างเจ้าของใหม่ ใช้กับบัญชีเดิมเท่านั้น ชื่อบัญชีไม่เปลี่ยน การเปลี่ยน `DASHBOARD_BOOTSTRAP_PASSWORD` แล้ว redeploy **ไม่รีเซ็ตบัญชีที่มีอยู่**

## ขอบเขตและการอนุมัติ

งานนี้เพิ่มและทดสอบได้เฉพาะ PostgreSQL ชั่วคราวในเครื่อง ไม่อนุญาตให้เชื่อมต่อหรือรีเซ็ต production ไม่ publish หรือ deploy การใช้กับฐานจริงเป็นการแก้ข้อมูลจริง ต้องให้เจ้าของอนุมัติแยก ตรวจฐานเป้าหมาย สำรองข้อมูล และตรวจสิทธิ์ก่อนเสมอ ห้ามส่งรหัสผ่านหรือ URL ฐานจริงในแชท/source/log

ไม่สมมติว่า container image มี binary นี้ หรือ Nortezh เปิด exec ได้ สามารถ build standalone binary แล้วรันจากเครื่อง operator ที่ได้รับอนุญาตและเข้าถึงฐานได้ หากฐานมี schema ปัจจุบันครบแล้ว ไม่ต้อง deploy API ใหม่ เครื่องมือนี้ไม่ migrate/seed และไม่เรียก startup ของ API

## เตรียมไฟล์ส่วนตัว

สร้างสองไฟล์นอก repository ด้วย editor ที่ไม่ sync/cloud/backup โดยไม่พิมพ์ค่าจริงใน command line:

- `db-url.txt`: PostgreSQL URI บรรทัดเดียว ระบุ user, password ที่ไม่ว่าง, host, database และ `sslmode=verify-full` สำหรับ remote host เพื่อยืนยันทั้ง CA และชื่อเซิร์ฟเวอร์ อนุญาต `disable` เฉพาะ IP literal `127.0.0.1`/`::1` สำหรับฐานทดลอง ไม่รวมชื่อ `localhost` หากไม่ระบุ port จะใช้ `5432` คงที่ อนุญาต query เฉพาะ `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `connect_timeout` และไม่รับชื่อซ้ำ ค่า timeout จะถูกกำหนดเป็น 5 วินาที ห้ามใช้ socket/service/passfile/identity/database override
- `temporary-password.txt`: รหัสชั่วคราวใหม่ที่สุ่มอย่างปลอดภัย ยาว 32–128 UTF-8 bytes ต้องไม่เหมือนรหัสปัจจุบันหรือ bootstrap แรก

user/password ใน URI เป็นบัญชี PostgreSQL ไม่ใช่ username/password ที่ลืมสำหรับหน้า Dashboard ใช้ค่า `DATABASE_URL` จากช่องทาง Secret ของเจ้าของระบบโดยไม่ส่งค่าผ่านแชต ไฟล์รับเฉพาะ URI ไม่ใช่บรรทัด `DATABASE_URL=...` หรือไฟล์ `.env` ทั้งไฟล์

ทั้งสองไฟล์ต้องเป็น regular file ไม่ใช่ symlink/device ขนาดไฟล์ URL ไม่เกิน 8192 bytes; ไฟล์รหัสไม่เกิน 133 bytes รองรับ UTF-8 BOM และไม่มี newline หรือมี LF/CRLF ท้ายไฟล์ **หนึ่งครั้ง** เท่านั้น ไม่ตัดช่องว่างต้น/ท้ายรหัส ช่องว่างที่ตั้งใจใส่เป็นส่วนหนึ่งของรหัส ห้ามมี newline เพิ่ม/NUL/UTF-8 เสีย

Windows: สร้างโฟลเดอร์ส่วนตัวที่ปิด inheritance ของ ACL และอนุญาตเฉพาะบัญชี operator (รวม SYSTEM/ผู้ดูแลที่จำเป็นตามนโยบาย) ตรวจใน Properties > Security ก่อนเก็บความลับ โปรแกรมไม่สามารถยืนยัน ACL ของ Windows ให้ได้ อย่าใช้โฟลเดอร์ shared/temp สาธารณะ Linux: `chmod 700` โฟลเดอร์และ `chmod 600` ทั้งสองไฟล์ โปรแกรมปฏิเสธไฟล์ที่เปิดสิทธิ์ group/other บน POSIX

## Build และใช้งาน Windows PowerShell

ต้องมี Go 1.25 ตาม module ของโครงการ จาก root repository:

```powershell
Set-Location backend
go build -o notify-admin.exe ./cmd/notify-admin
.\notify-admin.exe --help
.\notify-admin.exe owner show --db-url-file 'C:\private-owner-recovery\db-url.txt'
```

`show` อ่านอย่างเดียว พิมพ์เฉพาะ `username` และ `must_change_password` หากไม่พบบัญชีจะหยุด ไม่สร้างบัญชีให้ ตรวจว่าชื่อที่แสดงตรงกับเจ้าของที่ต้องการ แล้วแทน `EXACT_OWNER_FROM_SHOW` ในคำสั่งต่อไปด้วยชื่อนั้นแบบ case-sensitive (ไม่ใช่ `--yes`):

```powershell
.\notify-admin.exe owner reset-password --db-url-file 'C:\private-owner-recovery\db-url.txt' --confirm-username 'EXACT_OWNER_FROM_SHOW' --password-file 'C:\private-owner-recovery\temporary-password.txt'
```

ไม่มี password argument, env input หรือ interactive prompt ไม่อ่าน `DATABASE_URL` อัตโนมัติ ต้องระบุไฟล์ทุกครั้ง อย่า pipe รหัสไป stdout หรือใช้ shell command เขียนรหัสจริง เพราะอาจติด history โปรแกรมไม่พิมพ์ DSN, รหัส หรือข้อความผิดพลาดดิบของฐาน กำหนด context timeout 30 วินาทีสำหรับการทำงานฐานข้อมูล และไม่มี retry reset อัตโนมัติ หาก connection/commit ขาดหาย ให้ตรวจสถานะและประสาน operator ก่อนตัดสินใจใหม่ ไม่วนรัน reset

หาก process มี environment ชื่อขึ้นต้นด้วย `PG` โปรแกรมจะปฏิเสธก่อนเชื่อมต่อ เพื่อไม่ใช้ credentials, certificate, port หรือ startup options จาก libpq environment โดยไม่ตั้งใจ ใช้ shell/process เฉพาะงานที่ไม่มีค่าพวกนี้ ไม่ต้องเปลี่ยน environment ระดับ Windows หรือใช้ค่าจาก production มาเขียนทับค่าในเครื่อง

สำหรับ TLS ตัว driver ยังอาจใช้ client certificate/key ที่มีอยู่ในโฟลเดอร์ `.postgresql` ของ OS user ตามพฤติกรรมเดิมของ libpq เมื่อไม่ได้ระบุ `sslcert`/`sslkey` การปฏิเสธ `PG*` ไม่ได้ปิด fallback นี้ และไม่ได้ปิดการตรวจ hostname ของ `verify-full`

Linux ใช้ `go build -o notify-admin ./cmd/notify-admin` แล้ว `./notify-admin` พร้อม subcommand/flags เดียวกันและพาธไฟล์ส่วนตัวของ Linux

## หลังสำเร็จ

รหัสเดิมใช้ไม่ได้ รหัสชั่วคราวใช้ login ได้แต่ยังอ่านข้อมูลที่ต้องมี full session ไม่ได้ ต้องเปลี่ยนรหัสผ่านผ่านหน้า login เดิมทันที รหัสใหม่ต้องต่างจากรหัสชั่วคราวและ bootstrap แรกตามกฎเดิม หลังเปลี่ยนแล้วเข้าใช้งานตามปกติได้

ทุก web/native session ถูกเพิกถอนพร้อมกัน โทรศัพท์ต้อง login ใหม่ แต่ประวัติ alert/Ack, pending capability, อุปกรณ์ที่ลงทะเบียน, subscription และ key/encrypted token เดิมไม่ถูกลบหรือเปลี่ยน การกู้บัญชีไม่ได้รับประกันว่า FCM ส่งถึง/โทรศัพท์ดัง และไม่ได้ทดสอบการส่งจริงในงานนี้

การเพิกถอน session ไม่ยกเลิกคำขอที่ผ่านการตรวจสิทธิ์ไปแล้วก่อนการรีเซ็ต คำขอเหล่านั้นอาจทำงานจนจบได้

ลบเฉพาะไฟล์ความลับที่สร้างเองเมื่อเสร็จตามนโยบายเครื่อง (การลบไฟล์ไม่รับประกัน secure erase บน SSD/backup) อย่าเก็บรหัสชั่วคราวใน repository ไม่ต้องแก้ Android, HTTP auth, migration หรือ dependency
