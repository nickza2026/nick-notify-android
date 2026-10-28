# Deploy API bridge ด้วย Docker / Kubernetes

## 1. รองรับอะไรและยังไม่รองรับอะไร

รัน API bridge ปัจจุบันบน Docker และ Kubernetes ได้โดยไม่เปลี่ยนสัญญา API แต่ **ยังเป็น PoC แบบ single process/เครื่องรับหนึ่งเครื่อง** ดู schema จริงใน [server README](../server/README.md) ไม่ใช่ full API ในเอกสารสถาปัตยกรรม

- Container ใช้ `node:22.23.4-bookworm-slim` ตาม [Node.js security release 21 ต.ค. 2026](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) คง major 22 ไม่มี npm dependency จึงไม่ต้อง `npm install` การอัปเดต source pin ไม่ได้อัปเดต image ที่ deploy อยู่แล้ว ต้อง build/scan/rollout ใหม่แยกกัน
- Pin นี้ไม่ใช่การรับรองว่าปลอดช่องโหว่หรือใหม่ล่าสุด ต้อง scan image และปรับ patch/digest ที่ยืนยันจริงก่อน production ไม่ใส่ digest ที่เดาเอง
- รันเป็น UID/GID `1000:1000` ไม่ใช่ root, source เป็น read-only, เขียน idempotency เฉพาะ `/data`
- ตั้ง `HOST=0.0.0.0` ใน container โดยชัดเจน เพราะ default ของ server คือ `127.0.0.1` และจะรับผ่าน Service ไม่ได้หากไม่เปลี่ยน
- **Kubernetes: 1 replica + strategy Recreate + PVC เท่านั้น** ระหว่างอัปเดตมี downtime ไม่ใช่ high availability ห้ามเพิ่ม HPA หรือรันหลาย process แชร์ไฟล์เดิม
- ReadWriteOnce จำกัดลักษณะการ mount ตาม storage driver ไม่ใช่ cross-process lock และไม่ได้ป้องกันสอง Pod บน node เดียวกันโดยตัวมันเอง
- ต้องเปลี่ยน state เป็น transactional shared database/queue และออกแบบ distributed idempotency ก่อน scale หลาย replicas
- รุ่น 0.4 เพิ่ม [Ack sync](ack-sync-th.md) เมื่อกำหนด HTTPS public URL แต่ยังไม่มี business retry scheduler/HA; Pod Ready ไม่ใช่หลักฐานว่า Pixel รับ push หรือส่ง Ack กลับสำเร็จ

## 2. Build image

จาก project root (คำสั่ง PowerShell):

```powershell
Set-Location D:\works\notify-android
docker build --pull -t notify-alarm-api:0.4.0-poc .
```

Dockerfile copy เฉพาะ runtime `.mjs` สี่ไฟล์ ไม่ copy repository ทั้งก้อน `.dockerignore` เป็น allowlist และ exclude secrets, service accounts, Android build/config, `.letta`, `.git`, `.env`, private keys และ tests/docs ป้องกัน local credentials เข้า build context ไม่ใช้ `ARG`/`ENV` สำหรับใส่ secret ลง image

ตัวอย่างส่ง registry (เปลี่ยน image path ให้เป็น registry ของคุณก่อน):

```powershell
$Image = 'registry.example.com/your-project/notify-alarm-api:0.4.0-poc'
docker tag notify-alarm-api:0.4.0-poc $Image
docker push $Image
```

Production ควร deploy immutable digest หลัง scan แทนการนำ tag เดิมไปทับ หากใช้ private registry ต้องตั้ง imagePullSecret ตาม cluster; manifest นี้ยังไม่สร้างให้

## 3. เตรียม secret files นอก repository

เตรียมไดเรกทอรีส่วนตัว เช่น `D:\private\notify-alarm` ตั้ง ACL ให้อ่านเฉพาะผู้ดูแล และมีไฟล์:

| ไฟล์ส่วนตัว | เนื้อหา |
|---|---|
| `api-key.txt` | random API key อย่างน้อย 32 bytes ที่ caller ใช้ตรงกัน ไม่มี newline ท้ายไฟล์ |
| `device-token.txt` | FCM token ปัจจุบันของ Pixel ไม่มี newline ท้ายไฟล์ |
| `service-account.json` | service-account JSON ที่มีสิทธิ์ส่ง FCM เฉพาะ project เป้าหมาย |

ห้ามใส่ค่าจริงใน `secret.yaml.example` หรือ commit ไฟล์เหล่านี้ แม้ Kubernetes Secret จะ encode base64 ก็ไม่ใช่การเข้ารหัส ต้องใช้ RBAC/encryption-at-rest และ secret manager ตามนโยบาย cluster หลีกเลี่ยง `--from-literal=SECRET` เพราะค่าลับจะอยู่ใน process arguments/history

ไม่สร้าง secret สุ่มใหม่ทุกครั้งที่ deploy เพราะ caller ต้องใช้ key เดิมหรือมีแผน rotate ตรวจจำนวน bytes โดยไม่พิมพ์ค่า:

```powershell
$Private = 'D:\private\notify-alarm'
if (([IO.File]::ReadAllBytes((Join-Path $Private 'api-key.txt'))).Length -lt 32) {
    throw 'API key must contain at least 32 bytes'
}
```

### Docker local run

เตรียม `docker.env` นอก repository ผ่าน secret manager/editor ที่เชื่อถือได้ (ไม่วางค่าใน command history) รูปแบบแต่ละบรรทัดคือ `ALERT_API_KEY=<ค่าจริง>` และ `FCM_DEVICE_TOKEN=<ค่าจริง>` ห้าม export/echo เนื้อหาไฟล์ใน log ตัวอย่างนี้ไม่สร้าง env-file ที่มี placeholder แล้วอ้างว่าใช้ได้

```powershell
docker volume create notify-alarm-state
docker run --detach --name notify-alarm-api --init `
    --read-only --cap-drop ALL --security-opt no-new-privileges:true `
    --memory 256m --cpus 1 --pids-limit 100 `
    --publish 127.0.0.1:8787:8787 `
    --env-file (Join-Path $Private 'docker.env') `
    --env GOOGLE_APPLICATION_CREDENTIALS=/var/run/secrets/fcm/service-account.json `
    --mount 'type=volume,source=notify-alarm-state,target=/data' `
    --mount "type=bind,source=$Private\service-account.json,target=/var/run/secrets/fcm/service-account.json,readonly" `
    notify-alarm-api:0.4.0-poc

Invoke-RestMethod -Uri 'http://127.0.0.1:8787/health'
```

Named volume ที่สร้างใหม่รับ ownership ของ `/data` จาก image ตาม Docker volume copy-up behavior; หากใช้ volume เดิมหรือ bind-mount host path ต้องเตรียมสิทธิ์ UID/GID 1000 ให้เขียนได้เอง ไม่แก้ด้วยการรัน API เป็น root ห้ามใช้ volume เดียวกันพร้อมกันกับ container/Pod อื่น

`--env-file` ไม่ทำให้ secret มองไม่เห็นจากผู้มีสิทธิ์ `docker inspect`/Docker daemon ให้จำกัดสิทธิ์ Docker และ ACL ของไฟล์ ทดสอบ local bind เฉพาะ loopback ไม่เปิด public port

หยุด container ด้วย `docker stop --time 30 notify-alarm-api` และเก็บ volume ไว้ ห้าม `docker volume rm` เพื่อแก้ปัญหา idempotency โดยไม่ตรวจ incident เพราะอาจส่งซ้ำ

## 4. Kubernetes deployment

Manifest ใช้ namespace `notify-alarm` ถ้าจะเปลี่ยนให้เปลี่ยนทุกไฟล์/คำสั่งให้ตรงกัน ต้องมี default StorageClass ที่ provision PVC ได้ หรือกำหนด `storageClassName` ใน `pvc.yaml` เอง ไม่มีการ fallback เป็น `emptyDir` เพราะจะสูญเสีย dedupe เมื่อ Pod ถูกแทนที่

ตรวจ context ให้เป็น cluster ที่ตั้งใจ deploy ก่อน คำสั่งต่อไปนี้เป็นขั้นตอนสำหรับผู้ดูแล ไม่ใช่หลักฐานว่าได้ deploy แล้ว:

ตรวจ parse/render โดยไม่ติดต่อ cluster ได้ด้วย `kubectl kustomize .\deploy\k8s` (ไม่มี Secret รวมอยู่ใน output) การ render ผ่านไม่เท่ากับ server-side schema validation หรือการ provision volume สำเร็จ

```powershell
kubectl config current-context
kubectl apply -f .\deploy\k8s\namespace.yaml

kubectl -n notify-alarm create secret generic notify-alarm-secrets `
    --from-file="ALERT_API_KEY=$Private\api-key.txt" `
    --from-file="FCM_DEVICE_TOKEN=$Private\device-token.txt" `
    --from-file="service-account.json=$Private\service-account.json"

kubectl apply -f .\deploy\k8s\pvc.yaml
kubectl apply -f .\deploy\k8s\service.yaml
# ใช้ $Image จากขั้นตอน registry หรือ image local ที่ cluster runtime import ไว้แล้ว
$Deployment = kubectl set image --local -f .\deploy\k8s\deployment.yaml "api=$Image" -o yaml
if ($LASTEXITCODE -ne 0) { throw 'Failed to render deployment image' }
$Deployment | kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Deployment apply failed' }
kubectl -n notify-alarm rollout status deployment/notify-alarm --timeout=180s
kubectl -n notify-alarm get pods,pvc,service
```

ตรวจ exit code ของแต่ละคำสั่งก่อนทำขั้นถัดไป ตัวอย่างแยกตรวจผล render ก่อน pipe เข้า apply เพราะ PowerShell pipeline อาจซ่อน failure ของคำสั่งต้นทาง หากต้องเก็บ generated deployment ให้เก็บนอก repo และอย่าใส่ secrets ลงในไฟล์นั้น

`secret.yaml.example` เป็นเอกสารเท่านั้น ไม่ apply ทั้ง directory แบบรวมไฟล์ example และไม่ส่ง YAML ของ Secret ที่มีค่าจริงขึ้น console ถ้า Secret มีอยู่แล้วให้ใช้ secret-management workflow ของ cluster เพื่อ rotate ไม่ลบทิ้งแล้วสร้างใหม่ระหว่างใช้งานโดยไม่วางแผน

Manifest mount service-account JSON จาก Secret เป็นไฟล์ read-only; API key และ token เป็น environment values จาก `secretKeyRef` กำหนด `GOOGLE_APPLICATION_CREDENTIALS` เป็น path ของไฟล์ ไม่ใช่ JSON content

ตรวจสิทธิ์ volume/secret กับ CSI driver จริง (`fsGroup`, file mode และ ownership) หาก Pod `Permission denied` ให้แก้ storage permissions โดยไม่เพิ่ม root/privileged ให้ API

## 5. Health, readiness และ network

| Probe | สิ่งที่ตรวจ |
|---|---|
| Docker healthcheck / K8s startup/liveness | HTTP `/health` ตอบ 200; server ยังตอบสนอง ไม่เรียก FCM |
| K8s readiness | exec Node อ่าน `/health` และต้องมี `ready === true` ซึ่งหมายถึงโหลด config สำหรับ sender แล้วเท่านั้น |
| End-to-end verification | ต้องส่งเหตุการณ์จริงแล้วตรวจ Pixel รับ/เสียง/Ack แยกต่างหาก ยังไม่ใช่ probe นี้ |

อย่าใช้ HTTP 200 ของ `/health` เป็น readiness เพียงอย่างเดียว เพราะ server อาจตอบ 200 พร้อม `ready:false` ไม่ให้ liveness ยิง FCM เพราะจะทำให้ภายนอกล่มแล้ว Pod restart วน และอาจสร้างการเตือนรบกวน

Service เป็น `ClusterIP` ไม่มี LoadBalancer/NodePort/Ingress เริ่มทดสอบด้วย port-forward ที่ loopback:

```powershell
kubectl -n notify-alarm port-forward --address 127.0.0.1 service/notify-alarm 8787:8787
```

จากอีก shell เรียก API ตาม [server README](../server/README.md) โดยโหลด key จาก secret store ไม่ paste key ในคำสั่ง หากระบบต้นทางอยู่นอก cluster ให้เพิ่ม HTTPS reverse proxy/Ingress ที่เชื่อถือได้, authentication, firewall/allowlist และไม่ log Authorization/body/token ก่อนเปิดใช้จริง ClusterIP ไม่ใช่ firewall: Pod อื่นที่มี network reachability ยังเข้าถึงได้ ต้องมี NetworkPolicy/cluster isolation ที่เหมาะสม

Egress ต้องไป DNS, `oauth2.googleapis.com:443` และ `fcm.googleapis.com:443` ได้ ตัวอย่างนี้ไม่ใส่ NetworkPolicy แบบ IP ตายตัวสำหรับ Google เพราะ IP เปลี่ยนได้ ถ้า cluster default-deny ให้ใช้ egress gateway/FQDN policy ที่ CNI รองรับและออกแบบเอง ไม่เปิดกว้างโดยไม่ตรวจ

## 6. Shutdown, updates และข้อมูล

### เปิด Ack ในรุ่น 0.4

ต้องมี HTTPS reverse proxy/Ingress ที่มือถือเข้าถึงจริงก่อน ดู [Ack integration](ack-sync-th.md) Deployment อ้าง ConfigMap `notify-alarm-config` key `ACK_PUBLIC_BASE_URL` แบบ optional; หากยังไม่มีค่านี้ Ack ปิดอยู่ ไม่ใช้ hostname ตัวอย่างใน `configmap.yaml.example` เป็นค่าจริง

เมื่อเตรียม URL จริงแล้วสร้าง ConfigMap นอก kustomization ตาม environment และ rollout แบบ Recreate เพื่อให้ env มีผล ไฟล์ Ack ledger ค่าเริ่มต้นอยู่ที่ `/data/idempotency.json.acks.json` บน PVC เดียวกัน หาก override `ACK_STATE_PATH` ต้องเป็นคนละไฟล์กับ idempotency และอยู่บน writable persistent volume ด้วย สำรอง/restore ทั้งสองไฟล์ร่วมกันโดยประเมินโอกาสลืมเหตุการณ์หลัง snapshot

ไม่ลบ ConfigMap/ledger เพื่อแก้ startup failure เมื่อมี Ack-enabled records: startup จะ fail closed หาก ledger ที่จำเป็นหายหรือปิด Ack config ไป เพื่อไม่ยืนยัน Ack ผิดหรือหมุน capability ของ incident เดิม

Node รันเป็น process หลักและได้รับ SIGTERM โดยตรง ตัว server เพิ่ม handler เรียก `server.close()` เพื่อหยุดรับงานใหม่และรอ in-flight send/persist แล้ว โดยมีเพดาน drain 25 วินาทีก่อนปิด connection ที่เหลือ ขณะที่ Kubernetes ให้ `terminationGracePeriodSeconds: 30` ต้องทดสอบ Linux container/rollout จริงก่อนอ้างว่า drain สำเร็จทุกกรณี การปิดกลางส่งอาจเก็บ reservation เป็น `sending` แล้วคำขอเดิมตอบ 409 หลัง restart — เป็นการหลีกเลี่ยง resend โดยเดาผล ไม่ใช่ข้อมูลเสียที่ควรลบทิ้ง

- Recreate ลด overlap ใน rollout ปกติ แต่ไม่ทำให้เกิด distributed fencing ระหว่าง node partition/force-delete ห้าม force-delete Pod แล้วเริ่ม instance ใหม่โดยไม่ยืนยันตัวเก่าหยุด
- สำรอง PVC ตาม retention policy; snapshot/restore เก่าอาจลืมการส่งหลัง snapshot และเปิดโอกาสส่งซ้ำ ต้องประเมินก่อน restore
- Secret env values ถูกอ่านตอน startup; service account ก็โหลดตอน startup ดังนั้น rotate แล้วต้อง rollout restart แบบ Recreate พร้อมยอมรับ downtime
- Idempotency retention ปัจจุบัน 24 ชั่วโมง/5,000 records ไม่ใช่ incident ledger ถาวร และ memory/disk/latency ต้องวัดก่อนปรับ resource limits
- ถ้าต้องการ uptime สูง, business retry แบบทนทานและหลาย replica ให้ทำฐานข้อมูล/queue ร่วมก่อน ไม่แก้แค่เพิ่ม replicas; Ack ledger ปัจจุบันยังเป็น single-process file เช่นเดียวกับ idempotency

## 7. Checklist ก่อนใช้งานจริง

- [ ] Build image สำเร็จ, scan base/runtime และตรวจ UID1000/read-only root
- [ ] PVC เขียน/rename state ได้ และ restart แล้ว replay key เดิมไม่ส่งซ้ำ
- [ ] Secret file อ่านได้แต่ไม่ถูก copy ลง image/log และ key/token rotate ได้
- [ ] startup/liveness/readiness มีความหมายตรงตาราง ไม่อ้าง device delivery
- [ ] ทดสอบ SIGTERM ระหว่าง request และ rollout โดยไม่ส่งซ้ำ/ลบ reservation
- [ ] ตรวจ TLS/firewall/RBAC/NetworkPolicy/egress ตาม environment จริง
- [ ] ทดสอบ API → FCM → Pixel ล็อกจอ/Doze → เสียงวน → รับทราบในเครื่องจริง
- [ ] ทดสอบ HTTPS Ack และ offline sync บน Pixel จริง; รับทราบว่ายังไม่มี business retry scheduler/HA ก่อนผูกกับระบบตู้จริง

การมี Dockerfile/YAML ไม่เท่ากับ build image หรือ deploy cluster ผ่านแล้ว ต้องบันทึกคำสั่งและผลของ environment จริงแยกต่างหาก
