import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthUser {
  id: string
  name: string
  email: string | null
  role: string
  lastLogin?: string | null
}

interface AuthState {
  user: AuthUser | null
  login: (user: AuthUser) => void
  logout: () => void
  isAuthenticated: () => boolean
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      login: (user) => set({ user }),
      logout: () => set({ user: null }),
      isAuthenticated: () => !!get().user,
    }),
    {
      name: 'vpn-auth',
    },
  ),
)
