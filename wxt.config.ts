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
    permissions: ['storage', 'sidePanel', 'activeTab'],
    host_permissions: ['<all_urls>'],
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
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
});
