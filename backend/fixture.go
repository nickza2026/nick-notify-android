package backend

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
	"time"
)

// SeedDemo inserts synthetic Thai incidents without invoking any provider or external DB.
func SeedDemo(ctx context.Context, db *sql.DB) error {
	now := time.Now().UTC().Truncate(time.Second)
	states := []struct {
		id, title, message, outcome string
		age                         int
		acks                        []string
	}{
		{"demo_power", "ตัวอย่าง: ไฟฟ้าขัดข้อง", "ข้อมูลจำลอง: วงจรไฟฟ้าหยุดทำงาน", "provider_accepted", 5, []string{"batch", "repeat"}},
		{"demo_network", "ตัวอย่าง: เครือข่ายขัดข้อง", "ข้อมูลจำลอง: เกตเวย์ไม่ตอบสนอง", "provider_accepted", 4, []string{"batch"}},
		{"demo_storage", "ตัวอย่าง: พื้นที่จัดเก็บใกล้เต็ม", "ข้อมูลจำลอง: พื้นที่ดิสก์เหลือน้อย", "provider_accepted", 3, nil},
		{"demo_sensor", "ตัวอย่าง: เซนเซอร์แจ้งเตือน", "ข้อมูลจำลอง: อุณหภูมิสูงกว่าค่าทดสอบ", "provider_failed", 2, nil},
		{"demo_unknown", "ตัวอย่าง: ผลการส่งไม่แน่ชัด", "ข้อมูลจำลอง: ไม่ทราบผลการส่ง", "delivery_unknown", 1, nil},
		{"demo_backup", "ตัวอย่าง: สำรองข้อมูลล่าช้า", "ข้อมูลจำลอง: งานสำรองข้อมูลรอตรวจสอบ", "provider_accepted", 0, nil},
	}
	for _, v := range states {
		importance := "critical"
		if v.id == "demo_storage" {
			importance = "normal" // one unacknowledged accepted synthetic notification
		}
		created := now.Add(-time.Duration(v.age) * time.Hour)
		var accepted, completed any
		if v.outcome != "delivery_unknown" {
			completed = created.Add(2 * time.Second)
		}
		if v.outcome == "provider_accepted" {
			accepted = completed
		}
		_, e := db.ExecContext(ctx, `INSERT INTO alerts(id,idempotency_hash,body_hash,title,message,created_at,expires_at,outcome,provider_accepted_at,completed_at,importance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO NOTHING`, v.id, digest("demo-key:"+v.id), digest(v.id), v.title, v.message, created, created.Add(5*time.Minute), v.outcome, accepted, completed, importance)
		if e != nil {
			return e
		}
		for _, k := range v.acks {
			action := uuid.NewSHA1(uuid.NameSpaceOID, []byte("demo-"+k))
			ackTime := now.Add(-3*time.Hour - 30*time.Minute)
			if k == "repeat" {
				ackTime = now.Add(-3 * time.Hour)
			}
			client := ackTime
			received := ackTime.Add(2 * time.Second)
			_, e = db.ExecContext(ctx, `INSERT INTO ack_actions(alert_id,client_action_id,client_acked_at,received_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, v.id, action, client, received)
			if e != nil {
				return e
			}
		}
		if _, e = db.ExecContext(ctx, `UPDATE alerts a SET first_ack_at=(SELECT MIN(received_at) FROM ack_actions WHERE alert_id=a.id) WHERE a.id=$1 AND a.first_ack_at IS NULL AND EXISTS(SELECT 1 FROM ack_actions WHERE alert_id=a.id)`, v.id); e != nil {
			return e
		}
	}
	return nil
}
