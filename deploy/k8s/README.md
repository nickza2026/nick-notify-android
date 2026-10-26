# Kubernetes manifests

คู่มือภาษาไทยและคำสั่ง Docker/Kubernetes อยู่ที่ [docs/deployment-k8s-th.md](../../docs/deployment-k8s-th.md)

สำคัญ: ใช้ 1 replica และ `Recreate` เท่านั้นใน PoC นี้ เพราะ idempotency เป็นไฟล์ที่ไม่มี cross-process locking ต้องมี persistent volume และ Secret จริงนอก repository ไม่ apply `secret.yaml.example`
