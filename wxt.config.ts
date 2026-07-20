import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'FormSafe',
    short_name: 'FormSafe',
    description:
      'Privacy-first autosave for online forms. Drafts stay local in your browser.',
    homepage_url: 'https://github.com/MaryanKostrubyak/form-safe',
    permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
    optional_host_permissions: ['*://*/*'],
    minimum_chrome_version: '116',
    action: {
      default_title: 'FormSafe',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    commands: {
      'open-recovery': {
        suggested_key: { default: 'Alt+Shift+F' },
        description: 'Open FormSafe recovery',
      },
      'restore-latest': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: 'Restore the latest matching form session',
      },
    },
  },
});
