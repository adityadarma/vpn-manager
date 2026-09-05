// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

// https://astro.build/config
export default defineConfig({
  site: 'https://adityadarma.github.io',
  // GitHub Pages serves this project below /vpn-manager; local development uses
  // the root path so navigation works at http://localhost:4321/.
  base: process.env.GITHUB_ACTIONS ? '/vpn-manager' : '/',
  integrations: [
    starlight({
      title: 'VPN Manager',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/adityadarma/vpn-manager' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'introduction' },
            { label: 'Architecture', slug: 'architecture' },
            { label: 'Install the Manager', slug: 'installation/manager' },
            { label: 'Install a VPN Node', slug: 'installation/node' },
          ],
        },
        {
          label: 'Administration',
          items: [
            { label: 'Initial Setup', slug: 'administration/initial-setup' },
            { label: 'Users, Groups, and Access', slug: 'administration/access-management' },
            { label: 'Nodes and VPN Credentials', slug: 'administration/nodes-and-clients' },
            { label: 'Networking and Routing', slug: 'administration/networking' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Environment Configuration', slug: 'reference/environment' },
            { label: 'Operations and Security', slug: 'reference/operations-security' },
            { label: 'API and Development', slug: 'reference/api-development' },
            { label: 'Troubleshooting', slug: 'reference/troubleshooting' },
          ],
        },
      ],
    }),
    react(),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
})
