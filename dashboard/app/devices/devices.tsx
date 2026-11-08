'use client';

import { Alert, Button, Empty, Modal, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clientJSON } from '@/lib/client';
import { formatTime, type DevicesResponse, type RegisteredDevice } from '@/lib/protocol';

export default function Devices({ demo }: { demo: boolean }) {
  const [items, setItems] = useState<RegisteredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<RegisteredDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const request = useRef<AbortController | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const data = await clientJSON<DevicesResponse>('/api/devices', undefined, undefined, controller.signal);
      if (!controller.signal.aborted) setItems(data.items);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'โหลดรายชื่ออุปกรณ์ไม่สำเร็จ');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);
  useEffect(() => {
    const scroller = table.current?.querySelector<HTMLElement>('.ant-table-content');
    if (scroller) { scroller.tabIndex = 0; scroller.setAttribute('role', 'region'); scroller.setAttribute('aria-label', 'ตารางอุปกรณ์ เลื่อนแนวนอนได้'); }
  }, [items, loading]);

  async function revoke() {
    if (!pending || busyRef.current) return;
    const target = pending;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await clientJSON('/api/devices/' + encodeURIComponent(target.device_id), undefined, undefined, undefined, 'DELETE');
      setItems((current) => current.map((item) => item.device_id === target.device_id ? { ...item, active: false } : item));
      setPending(null); setNotice('ยกเลิกการรับรายการใหม่ของเครื่องนี้แล้ว เสียงที่เริ่มไปแล้วต้องกดรับทราบบนเครื่องนั้นเอง');
      await load();
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : 'ยกเลิกอุปกรณ์ไม่สำเร็จ') + ' — หากคำขอถูกขัดจังหวะ ให้รีเฟรชตรวจผลก่อนลองอีกครั้ง');
    } finally { busyRef.current = false; setBusy(false); }
  }
  const columns: TableColumnsType<RegisteredDevice> = [
    { title: 'อุปกรณ์', key: 'name', width: 210, render: (_, item) => <div><strong className="clamp">{item.device_name}</strong><small className="muted break">{item.device_id}</small></div> },
    { title: 'Key ID', key: 'keys', width: 140, render: (_, item) => item.key_ids.length ? item.key_ids.map((id) => <Tag key={id}>{id}</Tag>) : 'ไม่มีการผูก key' },
    { title: 'สถานะทะเบียน', key: 'active', width: 170, render: (_, item) => <Tag color={item.active ? 'success' : 'default'}>{item.active ? 'ลงทะเบียนรับอยู่' : 'ปิดรับรายการใหม่'}</Tag> },
    { title: 'อัปเดตทะเบียนล่าสุด', dataIndex: 'updated_at', key: 'updated', width: 210, render: (value: string) => <time dateTime={value}>{formatTime(value)}</time> },
    { title: 'จัดการ', key: 'action', width: 150, render: (_, item) => <Button disabled={!item.active || busy} onClick={() => { setNotice(''); setPending(item); }}>ยกเลิกการรับ</Button> },
  ];
  return <main className="shell">
    {demo && <Alert type="warning" showIcon message="ข้อมูลทดสอบ — ไม่ใช่อุปกรณ์จริง" />}
    <header className="page-header"><div><span className="eyebrow">บัญชีเดียว หลายเครื่อง</span><h1>อุปกรณ์รับแจ้งเตือน</h1><p>แอปแต่ละเครื่อง login บัญชีเดียวกันแล้วลงทะเบียนกับ key ที่ได้รับอนุญาต คำขอส่งหนึ่งครั้งกระจายไปยังเครื่องที่ลงทะเบียนอยู่</p></div><Button onClick={() => void load()} loading={loading} disabled={busy}>รีเฟรชอุปกรณ์</Button></header>
    <p className="muted">สถานะทะเบียนไม่ยืนยันว่าเครื่องออนไลน์หรือได้รับข้อความแล้ว แต่ละเครื่องต้องกดรับทราบเพื่อหยุดเสียงของตัวเอง</p>
    {error && <Alert type="error" showIcon message={error + ' — ข้อมูลที่แสดงอาจไม่เป็นปัจจุบัน'} />}
    {notice && <Alert type="info" showIcon message={notice} />}
    <section className="panel" aria-label="รายชื่ออุปกรณ์"><div className="table-wrap" ref={table}><Table<RegisteredDevice> rowKey="device_id" columns={columns} dataSource={items} pagination={false} loading={loading} scroll={{ x: 880 }} locale={{ emptyText: <Empty description="ยังไม่มีอุปกรณ์ ให้เปิดแอปและ login เพื่อลงทะเบียนเครื่อง" /> }} /></div></section>
    <Modal open={pending !== null} title="ยกเลิกการรับรายการใหม่?" onCancel={() => { if (!busy) setPending(null); }} closable={!busy} keyboard={!busy} mask={{ closable: !busy }} afterOpenChange={(open) => { if (open) cancelButton.current?.focus(); }} footer={<><Button ref={cancelButton} onClick={() => setPending(null)} disabled={busy}>กลับ</Button><Button type="primary" danger loading={busy} onClick={() => void revoke()}>ยืนยันยกเลิกเครื่อง</Button></>}>
      <p className="break">{pending?.device_name}</p><p>เครื่องนี้จะไม่อยู่ในปลายทางของคำขอใหม่ และ session ของแอปเครื่องนี้จะถูกยกเลิก ประวัติยังอยู่ เสียงที่เริ่มแล้วจะไม่หยุดจากปุ่มนี้</p>
    </Modal>
  </main>;
}
