import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/profile')({
  component: ProfilePage,
})

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { toast } from 'sonner'
import { User, Lock, Mail, Shield, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function ProfilePage() {
  const user = useAuthStore((s) => s.user)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const changePasswordMutation = useMutation({
    mutationFn: () => api.post('/api/v1/auth/change-password', {
      currentPassword,
      newPassword,
    }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password changed successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters')
      return
    }
    
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    
    changePasswordMutation.mutate()
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account settings</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Account Info */}
        <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="p-5 border-b border-border/50">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              Account Information
            </h2>
            <p className="text-xs text-muted-foreground mt-1">Your account details and role</p>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-muted/30 text-card-foreground rounded-xl border border-border/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">Username</span>
                  <div className="bg-primary/10 p-2 rounded-lg">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                </div>
                <div className="text-xl font-bold text-foreground">{user?.username ?? '—'}</div>
              </div>
              
              <div className="bg-muted/30 text-card-foreground rounded-xl border border-border/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">Email</span>
                  <div className="bg-blue-500/10 p-2 rounded-lg">
                    <Mail className="h-4 w-4 text-blue-500" />
                  </div>
                </div>
                <div className="text-xl font-bold text-foreground">{user?.email ?? 'Not set'}</div>
              </div>
              
              <div className="bg-muted/30 text-card-foreground rounded-xl border border-border/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">Role</span>
                  <div className="bg-emerald-500/10 p-2 rounded-lg">
                    <Shield className="h-4 w-4 text-emerald-500" />
                  </div>
                </div>
                <div className="text-xl font-bold text-foreground capitalize">{user?.role ?? '—'}</div>
              </div>
              
              <div className="bg-muted/30 text-card-foreground rounded-xl border border-border/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-muted-foreground">Last Login</span>
                  <div className="bg-amber-500/10 p-2 rounded-lg">
                    <Calendar className="h-4 w-4 text-amber-500" />
                  </div>
                </div>
                <div className="text-base font-bold text-foreground truncate">
                  {user?.lastLogin 
                    ? new Date(user.lastLogin).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Never'}
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* Change Password */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="p-5 border-b border-border/50">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Lock className="h-5 w-5 text-muted-foreground" />
            Change Password
          </h2>
          <p className="text-xs text-muted-foreground mt-1">Update your password to keep your account secure</p>
        </div>
        <div className="p-5">
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
              />
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password (min 6 characters)"
                required
                minLength={6}
              />
            </div>
            
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
                minLength={6}
              />
            </div>
            
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={changePasswordMutation.isPending || !currentPassword || !newPassword || !confirmPassword}
              >
                {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
    </div>
  )
}
