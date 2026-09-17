import { createRootRoute, Outlet } from '@tanstack/react-router'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog'

export const Route = createRootRoute({
  component: () => (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ConfirmDialogProvider>
        <Outlet />
        <Toaster />
      </ConfirmDialogProvider>
    </ThemeProvider>
  ),
})
