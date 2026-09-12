export type UserRole = 'admin' | 'user'

export interface User {
  id: string
  username: string
  email: string | null
  role: UserRole
  is_active: boolean
  last_login: string | null
  created_at: string
  updated_at: string
}

export interface UserWithPassword extends User {
  password_hash: string
}
