# บันทึกตรวจทานเอกสาร Remote Alert

วันที่: 19 ตุลาคม 2026  
เอกสาร: [สถาปัตยกรรมและข้อเสนอ API](remote-alert-system-th.md)

## วิธีตรวจ

- ให้ fork subagent อ่านเอกสารและ README จริงแบบ read-only แล้วตรวจความสอดคล้องของ API, multi-device Ack, Snooze, expiry, permissions และ security
- Subagent fetch เอกสารทางการซ้ำเรื่อง FCM priority, foreground service, full-screen intent/Play policy, Pushover และ Apple Critical Alerts/AlarmKit/background push
- ผู้เขียนตรวจ JSON examples, code fences, README link และการเข้าถึงแหล่งอ้างอิง HTTP โดยการเข้าถึง URL สำเร็จไม่ถือเป็นหลักฐานว่า implementation ผ่าน

## ข้อพบและการแก้ไข

| ระดับจาก reviewer | ข้อพบ | การแก้ไขในเอกสารหลัก |
|---|---|---|
| High | Ack ยังไม่ชัดว่าหยุดเสียงเครื่องอื่นอย่างไร | เพิ่ม terminal-state outbox หลัง Ack ใน transaction เดียวกัน พร้อม version, หยุดเสียง/ยกเลิก timer และระบุข้อจำกัดเครื่องออฟไลน์ |
| High | Snooze ไม่กัน in-flight retry และอาจเริ่มนับใหม่ตอน sync | persist local snoozed_until และตรวจทุกเส้นทาง; ส่ง intent times, ไม่ต่อช่วงใหม่ และระบุ time-validation errors |
| Medium | Ack ซ้ำข้ามเครื่อง/Snooze หลัง terminal ไม่ชัด | canonical Ack เดิมคืน 200; Snooze หลัง terminal และ Ack หลัง cancelled/expired คืน 409; ระบุ Cancel semantics เพิ่ม |
| Low | BOOT_COMPLETED restriction ไม่ระบุ target SDK | แก้เป็นแอป target API 35 ขึ้นไป |
| Low | ขาดตัวเลข payload budget | ระบุ FCM 4,096 bytes ตรวจ final payload ก่อน 202 และตอบ payload_too_large โดยไม่ตัดข้อความเงียบ ๆ |

เพิ่ม test cases ตามข้อพบ และตรวจเอกสารหลังแก้โดยผู้เขียน ข้อพบข้างต้นได้รับการแก้ในระดับเอกสารแล้ว แต่ไม่ได้อ้างว่า subagent ตรวจรอบใหม่หลังแก้ หรือทดสอบบนเครื่องจริงแล้ว

## ขอบเขตผลตรวจ

ใช้เป็นฐานวาง PoC ได้ ไม่ใช่ production-ready specification ยังต้องกำหนด final limits/clock-skew tolerance, ยืนยันแพลตฟอร์มเป้าหมาย, ทำ Android native PoC และพิสูจน์ test matrix จริง รวมถึงตรวจ store eligibility และ iOS entitlement
