'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, ConfigProvider, Select } from 'antd';
import { clientJSON } from '@/lib/client';

export default function ConsoleShell({ username, children }: { username: string; children: React.ReactNode }) {
  const path = usePathname();
  const [theme, setTheme] = useState('dark');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { setTheme(localStorage.getItem('notify-theme') ?? 'dark'); } catch { /* Storage may be unavailable. */ }
  }, []);

  function changeTheme(value: string) {
    setTheme(value);
    try { localStorage.setItem('notify-theme', value); } catch { /* Keep the current selection in memory. */ }
    document.documentElement.dataset.theme = value;
  }

  async function logout() {
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

  return <div className="console">
    <a className="skip-link" href="#content">ข้ามไปเนื้อหา</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand" href="/" aria-label="Notify หน้าประวัติ">Notify</Link>
      <nav className="main-nav" aria-label="เมนูหลัก">
        <Link href="/" aria-current={path === '/' ? 'page' : undefined}>ประวัติแจ้งเตือน</Link>
        <Link href="/test" aria-current={path === '/test' ? 'page' : undefined}>ส่งทดสอบ</Link>
      </nav>
      <div className="account-controls">
        <ConfigProvider theme={{ token: { fontSize: 14 } }}><Select className="theme-control" aria-label="รูปแบบสี" value={theme} onChange={changeTheme} options={[{ value: 'dark', label: 'มืด' }, { value: 'light', label: 'สว่าง' }, { value: 'system', label: 'ตามระบบ' }]} /></ConfigProvider>
        <Link href="/change-password" className="account-link">{username}</Link>
        <Button onClick={logout} loading={busy}>ออกจากระบบ</Button>
      </div>
    </div></header>
    <div className="workspace">{error && <Alert type="error" showIcon message={error} /> }<div id="content">{children}</div></div>
  </div>;
}
