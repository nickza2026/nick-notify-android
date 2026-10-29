'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clientJSON } from '@/lib/client';
export default function ConsoleShell({username,children}:{username:string;children:React.ReactNode}) {
  const path=usePathname();const [theme,setTheme]=useState('dark');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{try{setTheme(localStorage.getItem('notify-theme')??'dark');}catch{}},[]);
  function changeTheme(value:string){setTheme(value);try{localStorage.setItem('notify-theme',value);}catch{}document.documentElement.dataset.theme=value;}
  async function logout(){setBusy(true);setError('');try{await clientJSON('/api/auth/logout',{});window.location.assign('/login');}catch(e){setError(e instanceof Error?e.message:'ออกจากระบบไม่สำเร็จ');setBusy(false);}}
  return <div className="console"><a className="skip-link" href="#content">ข้ามไปเนื้อหา</a><aside className="sidebar"><Link className="brand" href="/" aria-label="Notify Console หน้าประวัติ"><span className="brand-mark">N</span><span>Notify <small>OPERATIONS CONSOLE</small></span></Link><p className="nav-caption">พื้นที่ปฏิบัติการ</p><nav aria-label="เมนูหลัก"><Link href="/" aria-current={path==='/'?'page':undefined}>◷ <span>ประวัติแจ้งเตือน</span></Link><Link href="/test" aria-current={path==='/test'?'page':undefined}>↗ <span>ส่งทดสอบ</span></Link></nav><div className="sidebar-note">ผลผู้ให้บริการ ≠ อุปกรณ์ได้รับ<br/>ตรวจสอบรายงานแตะรับทราบแยกเสมอ</div></aside><div className="workspace"><header className="topbar"><span className="workspace-label">ศูนย์แจ้งเตือน</span><div className="account-controls"><label className="theme-control"><span className="sr-only">รูปแบบสี</span><select aria-label="รูปแบบสี" value={theme} onChange={e=>changeTheme(e.target.value)}><option value="dark">มืด</option><option value="light">สว่าง</option><option value="system">ตามระบบ</option></select></label><Link href="/change-password" className="account-link">{username}</Link><button className="secondary-button" onClick={logout} disabled={busy}>{busy?'กำลังออก…':'ออกจากระบบ'}</button></div></header>{error&&<p role="alert" className="error">{error}</p>}<div id="content">{children}</div></div></div>;
}
