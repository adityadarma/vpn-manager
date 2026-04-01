import { useRouterState, useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/store/auth.store'
import { API_URL } from '@/lib/api'
import packageJson from '../../../../../package.json'
import {
  LayoutDashboard,
  Users,
  Server,
  Activity,
  Shield,
  LogOut,
  Network,
  UsersRound,
  UserCircle,
  ChevronsUpDown,
  ListTodo,
  FileText,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/users', label: 'Users', icon: Users },
  { href: '/groups', label: 'Groups', icon: UsersRound },
  { href: '/networks', label: 'Networks', icon: Network },
  { href: '/nodes', label: 'Nodes', icon: Server },
  { href: '/sessions', label: 'Sessions', icon: Activity },
  { href: '/policies', label: 'Policies', icon: Shield },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/audit', label: 'Audit Logs', icon: FileText, adminOnly: true },
] as const

export function AppSidebar() {
  const location = useRouterState({ select: (s) => s.location })
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const pathname = location.pathname

  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // Ignore errors — proceed with local cleanup
    }
    localStorage.removeItem('vpn-auth')
    useAuthStore.getState().logout()
    window.location.href = '/login'
  }

  return (
    <Sidebar collapsible="icon">
      {/* Brand */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                <Shield className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">VPN Manager</span>
                <span className="truncate text-xs text-muted-foreground">v{packageJson.version}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* Nav */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.filter(item => !('adminOnly' in item && item.adminOnly) || user?.role === 'admin').map(({ href, label, icon: Icon }) => {
                const active = pathname.startsWith(href) && (href !== '/' || pathname === '/')
                return (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      id={`nav-link-${href.replace(/[^a-z0-9]/g, '-')}`}
                      isActive={active}
                      tooltip={label}
                      onClick={() => navigate({ to: href })}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer / User Menu */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <UserCircle className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{user?.username ?? 'User'}</span>
                    <span className="truncate text-xs text-muted-foreground">{user?.email ?? 'No email'}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuItem onClick={() => navigate({ to: '/profile' })} className="cursor-pointer">
                  <UserCircle className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
