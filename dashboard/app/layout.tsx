import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'ประวัติการแจ้งเตือน', description: 'ดูประวัติการแจ้งเตือนและการรายงานแตะรับทราบ' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body>{children}</body></html>;
}
