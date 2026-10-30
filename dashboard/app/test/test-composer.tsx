'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Input, Modal, Radio, Timeline } from 'antd';
import { ClientError, clientJSON } from '@/lib/client';
import { ackLabel, count, formatTime, providerLabel, type AlertDetail } from '@/lib/protocol';

type Payload = { alert_id: string; title: string; message: string; ttl_seconds: number; importance: 'normal' | 'critical' };
type Attempt = { body: Payload; key: string };

export default function TestComposer() {
  const [importance, setImportance] = useState<'normal' | 'critical'>('normal');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [pollError, setPollError] = useState('');
  const [polling, setPolling] = useState(false);
  const [pending, setPending] = useState<Payload | null>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!attempt) return;
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let n = 0;
    const deadline = Date.now() + 120000;
    setPolling(true);
    setPollError('');
    async function poll() {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { setPolling(false); return; }
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(12000, remaining))]);
        const data = await clientJSON<AlertDetail>(`/api/alerts/${attempt!.body.alert_id}`, undefined, undefined, signal);
        if (cancelled) return;
        setDetail(data);
        setPollError('');
        if (data.acknowledged_at) { setPolling(false); return; }
      } catch (cause) {
        if (cancelled) return;
        setPollError(cause instanceof Error ? cause.message : 'โหลดรายงานไม่สำเร็จ');
        if (cause instanceof ClientError && ['session_required', 'password_change_required'].includes(cause.code)) {
          setPolling(false);
          return;
        }
      }
      if (!cancelled && ++n < 30 && Date.now() < deadline) timer = setTimeout(poll, Math.min(4000, deadline - Date.now()));
      else setPolling(false);
    }
    void poll();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [attempt]);

  async function send(value: Attempt) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setReceipt('');
    setDetail(null);
    setAttempt(value);
    try {
      const data = await clientJSON<{ alert_id: string; status: string }>('/api/test-alerts', value.body, { 'Idempotency-Key': value.key }, AbortSignal.timeout(12000));
      setReceipt(data.status === 'provider_accepted'
        ? 'ผู้ให้บริการรับคำขอแล้ว — ยังไม่ยืนยันว่าอุปกรณ์ได้รับหรือส่งเสียง'
        : 'ไม่ทราบผลส่ง — ตรวจสอบประวัติ ห้ามส่งซ้ำด้วยรหัสใหม่');
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : 'ไม่ทราบผลส่ง'} — ตรวจสอบประวัติก่อนลองคำขอเดิมอีกครั้ง`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function begin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    const data = new FormData(event.currentTarget);
    const title = String(data.get('title') ?? '');
    const message = String(data.get('message') ?? '');
    const ttl = Number(data.get('ttl'));
    if (!title.trim() || [...title].length > 120 || !message.trim() || [...message].length > 2000 || !Number.isInteger(ttl) || ttl < 30 || ttl > 10800) {
      setError('ตรวจสอบหัวข้อ 1–120 ตัวอักษร ข้อความ 1–2000 ตัวอักษร และ TTL 30–10800 วินาที');
      return;
    }
    const body: Payload = { alert_id: crypto.randomUUID(), title, message, ttl_seconds: ttl, importance };
    if (importance === 'critical') setPending(body);
    else void send({ body, key: crypto.randomUUID() });
  }

  function closeConfirm() {
    setPending(null);
    // Ant Modal restores focus to the trigger; this explicit restoration also covers Escape.
    setTimeout(() => submitButton.current?.focus(), 0);
  }

  const unique = detail ? [...new Map(detail.ack_actions.map((action) => [action.client_action_id, action])).values()] : [];
  return <main className="shell composer-shell">
    <header className="page-header"><div><span className="eyebrow">ทดสอบการแจ้งเตือน</span><h1>ส่งทดสอบ</h1><p>ส่งไปยังอุปกรณ์ที่ตั้งค่าไว้บนเซิร์ฟเวอร์ และตรวจสอบรายงานแตะรับทราบจริงจากมือถือ</p></div></header>
    <div className="composer-grid">
      <section className="panel"><h2>สร้างการแจ้งเตือน</h2><p className="muted">ปลายทาง: อุปกรณ์ที่ตั้งค่าไว้บนเซิร์ฟเวอร์</p>
        <form className="stack-form" onSubmit={begin}>
          <fieldset disabled={busy}><legend>ระดับการแจ้งเตือน</legend>
            <Radio.Group name="importance" value={importance} onChange={(event) => setImportance(event.target.value)}>
              <Radio className="radio-choice" value="normal"><strong>ธรรมดา · เงียบ</strong><small>ไม่ส่งเสียงหรือสั่น และไม่หยุดเสียงวิกฤตที่กำลังดัง</small></Radio>
              <Radio className="radio-choice" value="critical"><strong>วิกฤต · ปลุก</strong><small>เสียงต่อเนื่องจนกว่าผู้ใช้กดรับทราบบนมือถือ</small></Radio>
            </Radio.Group>
          </fieldset>
          {importance === 'critical' && <Alert type="warning" showIcon message="วิกฤตอาจส่งเสียงต่อเนื่อง ต้องมีคนกดรับทราบ TTL ไม่ใช่เวลาหยุดเสียง" />}
          <label>หัวข้อ<Input name="title" required disabled={busy} aria-describedby="title-limit" /></label>
          <small id="title-limit" className="muted">ไม่เกิน 120 ตัวอักษร Unicode</small>
          <label>ข้อความ<Input.TextArea name="message" rows={5} required disabled={busy} aria-describedby="message-limit" /></label>
          <small id="message-limit" className="muted">ไม่เกิน 2000 ตัวอักษร Unicode · เซิร์ฟเวอร์ตรวจขนาดไบต์อีกครั้ง</small>
          <label>TTL (วินาที)<Input type="number" name="ttl" min={30} max={10800} defaultValue={300} required disabled={busy} /></label>
          <p className="muted">ช่วงเวลาที่อนุญาตให้เริ่มแจ้งเตือน 30–10800 วินาที ไม่ใช่เวลาหยุดเสียง</p>
          <Button ref={submitButton} htmlType="submit" type="primary" loading={busy}>{busy ? 'กำลังส่ง…' : attempt ? 'ส่งเหตุการณ์ใหม่' : 'ส่งทดสอบ'}</Button>
        </form>
      </section>
      <section className="panel receipt-panel" aria-live="polite"><span className="eyebrow">ผลคำขอล่าสุด</span><h2>ผลผู้ให้บริการ / รายงานแตะ</h2>
        {!attempt && <p className="muted">ยังไม่ได้ส่งทดสอบ ผลจะปรากฏหลังคุณส่งคำขอ ไม่มีการส่งอัตโนมัติ</p>}
        {error && <Alert type="error" showIcon message={error} />}
        {receipt && <Alert type={receipt.startsWith('ผู้ให้บริการรับ') ? 'info' : 'warning'} showIcon message={receipt} />}
        {attempt && <>
          <p className="break">รหัสเหตุการณ์: <strong>{attempt.body.alert_id}</strong></p>
          <p className="muted">การไม่มีรายงานแตะไม่ได้พิสูจน์ว่าอุปกรณ์ไม่เคยได้รับข้อความ</p>
          {detail && <Descriptions className="detail-fields" column={1} size="small" items={[
            { key: 'provider', label: 'ผลผู้ให้บริการ', children: providerLabel(detail) },
            { key: 'ack', label: 'รายงานแตะ', children: ackLabel(detail) },
            { key: 'count', label: 'จำนวนการแตะไม่ซ้ำของเหตุการณ์', children: count(detail.ack_count) },
            { key: 'first', label: 'เซิร์ฟเวอร์รับครั้งแรก', children: formatTime(detail.acknowledged_at) },
          ]} />}
          {polling && <p role="status" className="muted">กำลังตรวจรายงานแตะทุก 4 วินาที (สูงสุด 2 นาที)</p>}
          {!polling && <p className="muted">หยุดตรวจอัตโนมัติแล้ว ดูข้อมูลล่าสุดได้ที่ประวัติ</p>}
          {pollError && <Alert type="warning" showIcon message={`${pollError} — ข้อมูลเดิมอาจไม่เป็นปัจจุบัน`} />}
          {unique.length > 0 && <Timeline className="timeline" items={unique.map((action) => ({ children: <><strong>เซิร์ฟเวอร์รับ: {formatTime(action.received_at)}</strong><span>เวลาอุปกรณ์: {formatTime(action.client_acked_at)}</span><small className="break">{action.client_action_id}</small></> }))} />}
          {error && <Button disabled={busy} onClick={() => void send(attempt)}>ลองคำขอเดิม (รหัสและข้อมูลเดิม)</Button>}
          <p><Link className="text-link" href="/">ตรวจสอบประวัติทั้งหมด →</Link></p>
        </>}
      </section>
    </div>
    <Modal open={pending !== null} title="ยืนยันส่งแบบวิกฤต?" onCancel={closeConfirm} footer={<><Button ref={cancelButton} onClick={closeConfirm}>ยกเลิก</Button><Button type="primary" danger onClick={() => { const body = pending; closeConfirm(); if (body) void send({ body, key: crypto.randomUUID() }); }}>ยืนยันส่งวิกฤต</Button></>} afterOpenChange={(open) => { if (open) cancelButton.current?.focus(); }} destroyOnHidden>
      <p>อุปกรณ์อาจส่งเสียงต่อเนื่องจนกว่าคนจะกดรับทราบบนมือถือ แม้ TTL จะหมดแล้ว</p>
      <p>ตรวจสอบว่าผู้ใช้พร้อมรับการทดสอบนี้</p>
    </Modal>
  </main>;
}
