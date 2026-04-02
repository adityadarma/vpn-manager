// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  integrations: [starlight({
			title: 'VPN Manager',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/adityadarma/ovpn-manager' }],
			sidebar: [
          {
              label: 'Overview',
              items: [
                  { label: 'Introduction', slug: 'overview/introduction' },
                  { label: 'Architecture', slug: 'overview/architecture' },
              ],
          },
          {
              label: 'Guidelines',
              items: [
                  { label: 'Monorepo Setup', slug: 'guidelines/monorepo' },
              ]
          },
          {
              label: 'Mechanics',
              items: [
                  { label: 'VPN Split Tunneling', slug: 'mechanics/split-tunneling' },
              ]
          },
			],
  }), react()],

  vite: {
    plugins: [tailwindcss()],
  },
});