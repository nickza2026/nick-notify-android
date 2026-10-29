'use client';

import { useState } from 'react';
import { clientJSON } from '@/lib/client';

type Session = { user: { username: string; must_change_password: boolean }; expires_at: string };

export default function AuthForm({ change = false }: { change?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await clientJSON('/api/auth/logout', {});
      window.location.assign('/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ออกจากระบบไม่สำเร็จ');
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setError('');
    const next = String(data.get('new_password') ?? '');
    if (change && ([...next].length < 15 || new TextEncoder().encode(next).length > 128)) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 15 ตัวอักษร และไม่เกิน 128 ไบต์');
      return;
    }
    if (change && next !== data.get('confirm')) {
      setError('ยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }
    setBusy(true);
    try {
      const session = await clientJSON<Session>(change ? '/api/auth/change-password' : '/api/auth/login', change
        ? { current_password: data.get('current_password'), new_password: next }
        : { username: data.get('username'), password: data.get('password') });
      form.reset();
      window.location.assign(session.user.must_change_password ? '/change-password' : '/');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ดำเนินการไม่สำเร็จ');
      setBusy(false);
    }
  }

  return <main className="auth-page"><div className="auth-card">
    <h1>{change ? 'ตั้งรหัสผ่านใหม่' : 'เข้าสู่ระบบ'}</h1>
    <p className="muted">{change
      ? 'ต้องเปลี่ยนรหัสผ่านเริ่มต้นก่อนอ่านประวัติหรือส่งแจ้งเตือน การเปลี่ยนรหัสจะออกจากระบบบน session อื่นทั้งหมด'
      : 'สำหรับผู้ดูแลระบบเท่านั้น ไม่มีการสมัครบัญชีสาธารณะ'}</p>
    <form className="stack-form" onSubmit={submit}>
      {!change && <label>ชื่อผู้ใช้<input name="username" autoComplete="username" required maxLength={64} autoFocus /></label>}
      <label>{change ? 'รหัสผ่านปัจจุบัน' : 'รหัสผ่าน'}<input type="password" name={change ? 'current_password' : 'password'} autoComplete="current-password" required autoFocus={change} maxLength={1024} /></label>
      {change && <>
        <label>รหัสผ่านใหม่<input type="password" name="new_password" autoComplete="new-password" required aria-describedby="password-help" maxLength={128} /></label>
        <p id="password-help" className="muted">อย่างน้อย 15 ตัวอักษร และไม่เกิน 128 ไบต์ UTF-8 ต้องไม่ซ้ำรหัสเดิม</p>
        <label>ยืนยันรหัสผ่านใหม่<input type="password" name="confirm" autoComplete="new-password" required maxLength={128} /></label>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'กำลังตรวจสอบ…' : change ? 'บันทึกรหัสผ่านใหม่' : 'เข้าสู่ระบบ'}</button>
    </form>
    {change && <div className="filter-actions"><a className="text-link" href="/">กลับหน้าประวัติ</a><button type="button" className="secondary-button" onClick={logout} disabled={busy}>ออกจากระบบ</button></div>}
  </div></main>;
}
