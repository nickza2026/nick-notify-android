# ดาวน์โหลด APK ผ่าน Node บน LAN

ไม่ใช่ Backend แจ้งเตือน และไม่ต้องตั้ง Firebase เพื่อใช้หน้านี้ Node server เปิดเฉพาะหน้าโหลดกับ APK snapshot หนึ่งไฟล์ ไม่เปิด directory listing, source code, `.env` หรือ credentials

ค่าเริ่มต้นรอบนี้เสิร์ฟเฉพาะ `artifacts/notify-alarm-0.6.0-safety-debug.apk` (versionCode 6) ไม่ใช้ `notify-alarm-poc-debug.apk` รุ่นเก่าที่อาจค้างอยู่ การรัน `scripts/build-android.ps1` ในอนาคตจะเขียน generic artifact; ตรวจ version และทำ snapshot ใหม่ก่อนเปิด LAN server รอบถัดไป อย่าแทนชื่อไฟล์ใหม่ด้วย APK เก่า

`artifacts/` ถูก gitignore: หลัง clone GitHub ต้อง build ในเครื่องหรือดาวน์โหลด [GitHub Actions artifact ที่เซ็นตรงกับ Pixel](github-apk-build-th.md) มาใส่ชื่อไฟล์นี้ด้วยตนเองก่อนเริ่ม LAN server อย่าใช้ debug APK จาก compile-only CI แทน เพราะ signer และ Firebase client ไม่ตรง

```powershell
Set-Location D:\works\notify-android
node .\scripts\serve-apk.mjs
```

ใช้ Node 22 ขึ้นไป ระบบจะแสดง URL ที่มีรหัสสุ่ม ให้มือถืออยู่ Wi-Fi/เครือข่ายเดียวกันแล้วเปิด URL ของการ์ด Wi-Fi/Ethernet จริง (ไม่ใช้ `127.0.0.1` จากมือถือ และไม่ใช้ IP ของ Docker/WSL/VPN)

- Default port: `8788`; เปลี่ยนได้ด้วย `$env:APK_PORT='8789'` ก่อนเริ่ม
- ปิดตัวเองหลัง 2 ชั่วโมง หรือกด Ctrl+C
- เป็น HTTP สำหรับ LAN ที่ไว้ใจเท่านั้น ไม่ทำ port-forward/router/Ingress และไม่แก้ Windows firewall ให้อัตโนมัติ
- หาก Windows ขออนุญาต network ให้ใช้เฉพาะ Private network ที่ไว้ใจ หากโหลดไม่ได้ตรวจ firewall, guest Wi-Fi isolation และเลือก IP ให้ตรงเครือข่าย
- ไฟล์ถูกอ่านเป็น snapshot ตอนเริ่ม server จึงไม่ขาดกลางทางหาก build ใหม่ ต้อง restart server เพื่อเสิร์ฟ APK รุ่นใหม่
- หน้าดาวน์โหลดแสดง SHA-256 เพื่อเทียบกับไฟล์ที่ build
- APK เป็น debug-signed PoC ใช้ติดตั้งอัปเดตทับแอปเดิม ไม่ใช่ release สำหรับ production

ทดสอบ route isolation: `node --test .\scripts\tests\serve-apk.test.mjs` (ต้องมี APK ใน artifacts)
