'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input } from 'antd';
import { ClientError, clientJSON } from '@/lib/client';
import { publicAuthConfig, type PublicAuthConfig } from '@/lib/google-contract';
import { prepareGoogleSignIn, signInGoogleOwner } from '@/lib/google';

type Session = { user: { username: string; must_change_password: boolean }; expires_at: string };

export default function AuthForm({ change = false }: { change?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [config,setConfig]=useState<PublicAuthConfig|null>(null);
  const [loading,setLoading]=useState(true);
  const gate=useRef(false);
  const mounted=useRef(false);

  useEffect(()=>{
    mounted.current=true;
    const abort=new AbortController();
    void clientJSON<unknown>('/api/auth/config',undefined,undefined,abort.signal)
      .then(value=>{
        const next=publicAuthConfig(value);
        if (next.mode==='google' && next.firebase) prepareGoogleSignIn(next.firebase);
        if (!abort.signal.aborted) {
          setConfig(next);
          if (change && next.mode==='google') window.location.replace('/');
        }
      }).catch(cause=>{
        if (!abort.signal.aborted) setError(cause instanceof ClientError ? cause.message : 'การตั้งค่าเข้าสู่ระบบยังไม่พร้อม กรุณาติดต่อผู้ดูแล');
      }).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return ()=>{mounted.current=false;abort.abort();};
  },[change]);

  async function googleLogin() {
    if (gate.current || !config || config.mode!=='google' || !config.firebase) return;
    gate.current=true;setBusy(true);setError('');
    try {
      await signInGoogleOwner(config.firebase,async body=>{
        // A late popup result must not establish a new local session after leaving.
        if (!mounted.current) throw Error('ยกเลิกการเข้าสู่ระบบแล้ว');
        const result=await clientJSON<Session>('/api/auth/google-login',body);
        if (result.user.must_change_password) throw Error('ไม่สามารถยืนยันรูปแบบบัญชี Google ได้');
      });
      if (mounted.current) window.location.assign('/');
    } catch(cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'เข้าสู่ระบบ Google ไม่สำเร็จ');
    } finally {
      gate.current=false;
      if (mounted.current) setBusy(false);
    }
  }

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
    if (busy || config?.mode!=='password') return;
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
    {loading && <p role="status">กำลังตรวจสอบช่องทางเข้าสู่ระบบ…</p>}
    {!loading && !config && <Button onClick={()=>window.location.reload()}>ตรวจสอบการตั้งค่าอีกครั้ง</Button>}
    {config?.mode==='google' && !change && <div className="stack-form">
      <Button type="primary" onClick={googleLogin} loading={busy} disabled={busy}>Sign in with Google</Button>
      <p className="muted">ใช้เฉพาะบัญชี Google ที่เจ้าของระบบอนุญาต ไม่ต้องตั้งรหัสผ่านสำหรับ Dashboard</p>
    </div>}
    {config?.mode==='password' && <form className="stack-form" onSubmit={submit}>
      {!change && <label>ชื่อผู้ใช้<Input name="username" autoComplete="username" required maxLength={64} autoFocus /></label>}
      <label>{change ? 'รหัสผ่านปัจจุบัน' : 'รหัสผ่าน'}<Input.Password name={change ? 'current_password' : 'password'} autoComplete="current-password" required autoFocus={change} maxLength={1024} /></label>
      {change && <>
        <label>รหัสผ่านใหม่<Input.Password name="new_password" autoComplete="new-password" required aria-describedby="password-help" maxLength={128} /></label>
        <p id="password-help" className="muted">อย่างน้อย 15 ตัวอักษร และไม่เกิน 128 ไบต์ UTF-8 ต้องไม่ซ้ำรหัสเดิม</p>
        <label>ยืนยันรหัสผ่านใหม่<Input.Password name="confirm" autoComplete="new-password" required maxLength={128} /></label>
      </>}
      <Button htmlType="submit" type="primary" loading={busy}>{change ? 'บันทึกรหัสผ่านใหม่' : 'เข้าสู่ระบบ'}</Button>
    </form>}
    {error && <Alert type="error" showIcon message={error} />}
    {!change && <p className="muted"><a href="/google-account">เจ้าของระบบ: ตรวจ Firebase UID ของบัญชี Google</a></p>}
    {change && config?.mode==='password' && <div className="filter-actions"><a className="text-link" href="/">กลับหน้าประวัติ</a><Button onClick={logout} loading={busy}>ออกจากระบบ</Button></div>}
  </div></main>;
}
