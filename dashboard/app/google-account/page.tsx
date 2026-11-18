'use client';

import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Typography} from 'antd';
import {ClientError,clientJSON} from '@/lib/client';
import {firebaseWebConfig,type FirebaseWebConfig} from '@/lib/google-contract';
import {prepareGoogleSignIn,signInGoogleOwner} from '@/lib/google';

export default function GoogleAccountSetup() {
  const [config,setConfig]=useState<FirebaseWebConfig|null>(null);
  const [error,setError]=useState('');
  const [uid,setUID]=useState('');
  const [busy,setBusy]=useState(false);
  const active=useRef(false);
  const gate=useRef(false);
  useEffect(()=>{
    active.current=true;
    const abort=new AbortController();
    void clientJSON<{firebase:unknown}>('/api/auth/google-setup',undefined,undefined,abort.signal)
      .then(value=>{const next=firebaseWebConfig(value.firebase);prepareGoogleSignIn(next);if(!abort.signal.aborted)setConfig(next);})
      .catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof ClientError ? cause.message : 'กรุณาตั้งค่า Firebase Web ของโครงการก่อน');});
    return ()=>{active.current=false;abort.abort();};
  },[]);
  async function inspect() {
    if(!config || gate.current)return;
    gate.current=true;setBusy(true);setError('');setUID('');
    try {
      await signInGoogleOwner(config,async(_token,identity)=>{if(active.current)setUID(identity.uid);});
    } catch(cause) {if(active.current)setError(cause instanceof Error ? cause.message : 'ตรวจ Google account ไม่สำเร็จ');}
    finally {gate.current=false;if(active.current)setBusy(false);}
  }
  return <main className="auth-page"><div className="auth-card">
    <h1>ตรวจ Firebase UID ของบัญชี Google</h1>
    <p>สำหรับเจ้าของระบบเตรียม UID ก่อนเปิด Google login เลือก Google ของคุณในโครงการ Firebase นี้</p>
    <p className="muted">หน้านี้ไม่ให้สิทธิ์ Dashboard ไม่สร้างบัญชีเจ้าของ ไม่ผูกอุปกรณ์ และไม่แสดง ID token การอนุญาตเข้าระบบยังตรวจ UID ฝั่ง API แยกต่างหาก</p>
    <Button type="primary" disabled={!config || busy} loading={busy} onClick={inspect}>เลือกบัญชี Google เพื่อตรวจ UID</Button>
    {uid && <div role="status"><p>Firebase UID ของบัญชีที่คุณเลือก:</p><Typography.Paragraph copyable>{uid}</Typography.Paragraph><p>นำ UID นี้ไปตั้งค่า FIREBASE_OWNER_UID ฝั่ง API ผ่านช่องทาง configuration ส่วนตัว</p></div>}
    {error && <Alert type="error" showIcon message={error}/>}
    <p><a href="/login">กลับหน้าเข้าสู่ระบบ</a></p>
  </div></main>;
}
