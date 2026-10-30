import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import AntProvider from './ant-provider';
import 'antd/dist/reset.css';
import './globals.css';

export const metadata: Metadata = { title: 'ประวัติการแจ้งเตือน', description: 'ดูประวัติการแจ้งเตือนและการรายงานแตะรับทราบ' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:"try{var t=localStorage.getItem('notify-theme');document.documentElement.dataset.theme=['dark','light','system'].includes(t)?t:'dark'}catch(e){document.documentElement.dataset.theme='dark'}"}}/></head><body><AntdRegistry><AntProvider>{children}</AntProvider></AntdRegistry></body></html>;
}
