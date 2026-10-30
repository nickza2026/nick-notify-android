'use client';

import { ConfigProvider, theme } from 'antd';
import thTH from 'antd/locale/th_TH';
import { useEffect, useState, type ReactNode } from 'react';
import { antTheme } from '@/lib/ant-theme';
import 'dayjs/locale/th';

function Surface({ children, dark }: { children: ReactNode; dark: boolean }) {
  const { token } = theme.useToken();
  // Only composition/copy consumes these aliases. Ant Design owns control paint.
  const variables = `:root{color-scheme:${dark ? 'dark' : 'light'};--bg:${token.colorBgLayout};--surface:${token.colorBgContainer};--ink:${token.colorText};--muted:${token.colorTextSecondary};--line:${token.colorBorderSecondary};--control-border:${token.colorBorder};--accent:${token.colorLink};--danger:${token.colorErrorText}}`;
  return <><style>{variables}</style>{children}</>;
}

export default function AntProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      const mode = document.documentElement.dataset.theme;
      setDark(mode === 'system' ? media.matches : mode !== 'light');
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    media.addEventListener('change', sync);
    sync();
    return () => { observer.disconnect(); media.removeEventListener('change', sync); };
  }, []);
  return <ConfigProvider locale={thTH} theme={antTheme(dark)}><Surface dark={dark}>{children}</Surface></ConfigProvider>;
}
