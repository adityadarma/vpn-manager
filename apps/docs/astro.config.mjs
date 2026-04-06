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
                  { label: 'Monorepo Architecture', slug: 'overview/monorepo-structure' },
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
                  { label: 'RBAC & Routing', slug: 'mechanics/rbac-and-routing' },
                  { label: 'API Backend', slug: 'mechanics/api-backend' },
                  { label: 'VPN Agent', slug: 'mechanics/vpn-agent' },
                  { label: 'Web Dashboard', slug: 'mechanics/web-dashboard' },
                  { label: 'Database Schema', slug: 'mechanics/database-schema' },
              ]
          },
			],
  }), react()],

  vite: {
    plugins: [tailwindcss()],
  },
});