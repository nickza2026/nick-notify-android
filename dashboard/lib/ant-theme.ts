import { theme, type ThemeConfig } from 'antd';

export function antTheme(dark: boolean): ThemeConfig {
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif',
      fontSize: 16,
      controlHeight: 44,
      borderRadius: 6,
      colorPrimary: '#1668dc',
      colorLink: dark ? '#69b1ff' : '#0958d9',
      colorLinkHover: dark ? '#91caff' : '#003eb3',
      colorError: '#b91c1c',
      colorErrorText: dark ? '#ffb3ad' : '#b42318',
      colorBorder: dark ? '#737373' : '#8c8c8c',
      colorText: dark ? '#f0f0f0' : '#1f1f1f',
      colorTextSecondary: dark ? '#bfbfbf' : '#595959',
      colorTextDescription: dark ? '#bfbfbf' : '#595959',
      colorBgContainer: dark ? '#1f1f1f' : '#ffffff',
      colorBgLayout: dark ? '#141414' : '#f5f5f5',
      motion: false,
    },
    components: {
      // This console uses filled status Tags. Keep their text readable without
      // changing solid danger-button backgrounds elsewhere in the application.
      Tag: {
        colorSuccess: dark ? '#95de64' : '#237804',
        colorWarning: dark ? '#ffd666' : '#874d00',
        colorError: dark ? '#ffb3ad' : '#b42318',
      },
    },
  };
}
