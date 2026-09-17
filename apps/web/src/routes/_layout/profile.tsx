import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { toast } from 'sonner'
import {
  User,
  Lock,
  Mail,
  Shield,
  Key,
  Check,
  Copy,
  Eye,
  EyeOff,
  Activity,
  FileText,
  ExternalLink,
  Clock,
  Fingerprint,
  RefreshCw,
  BadgeCheck,
  Globe,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBrowserDateTime, type User as UserType } from '@vpn/shared'

export const Route = createFileRoute('/_layout/profile')({
  component: ProfilePage,
})

interface AuditLogSummary {
  id: string
  action: string
  resource_type: string
  resource_id?: string
  ip_address?: string
  created_at: string
}

function getActionMeta(action: string) {
  if (action.includes('create')) {
    return {
      label: action.replace(/_/g, ' ').toUpperCase(),
      className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    }
  }
  if (action.includes('update') || action.includes('change')) {
    return {
      label: action.replace(/_/g, ' ').toUpperCase(),
      className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    }
  }
  if (action.includes('delete') || action.includes('revoke') || action.includes('kick')) {
    return {
      label: action.replace(/_/g, ' ').toUpperCase(),
      className: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    }
  }
  return {
    label: action.replace(/_/g, ' ').toUpperCase(),
    className: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  }
}

// eslint-disable-next-line react-refresh/only-export-components
function ProfilePage() {
  const qc = useQueryClient()
  const authStoreUser = useAuthStore((s) => s.user)
  const login = useAuthStore((s) => s.login)

  // 1. Fetch fresh current user info from API
  const { data: meUser, isLoading: isLoadingMe } = useQuery<UserType>({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/api/v1/auth/me'),
  })

  const user = meUser ?? authStoreUser

  // 2. Personal Information Form State (derived state with user input override)
  const [nameOverride, setNameOverride] = useState<string | null>(null)
  const [emailOverride, setEmailOverride] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState(false)

  const name = nameOverride !== null ? nameOverride : (user?.name ?? '')
  const email = emailOverride !== null ? emailOverride : (user?.email ?? '')

  const isProfileChanged =
    (nameOverride !== null && nameOverride.trim() !== (user?.name ?? '')) ||
    (emailOverride !== null && emailOverride.trim() !== (user?.email ?? ''))

  // 3. Change Password Form State
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // 4. Fetch User's VPN Certificates count
  const { data: userCerts = [] } = useQuery<Array<{ id: string; is_revoked: boolean }>>({
    queryKey: ['profile-certs', user?.id],
    queryFn: () => api.get(`/api/v1/users/${user?.id}/certificates`),
    enabled: !!user?.id,
  })

  // 5. Fetch Recent Audit Logs by this user
  const { data: logsData, isLoading: isLoadingLogs } = useQuery<{ logs: AuditLogSummary[] }>({
    queryKey: ['profile-audit-logs', user?.id],
    queryFn: () => api.get(`/api/v1/audit/logs?user_id=${user?.id}&limit=4`),
    enabled: !!user?.id,
  })
  const recentLogs = logsData?.logs ?? []

  // 6. Mutations
  const updateProfileMutation = useMutation({
    mutationFn: (payload: { name: string; email: string }) =>
      api.patch<UserType>(`/api/v1/users/${user?.id}`, payload),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['auth-me'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      setNameOverride(null)
      setEmailOverride(null)
      if (updated && authStoreUser) {
        login({
          ...authStoreUser,
          name: updated.name,
          email: updated.email,
        })
      }
      toast.success('Profile details updated successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      api.post('/api/v1/auth/change-password', {
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

  const handleUpdateProfile = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Full name is required')
      return
    }
    updateProfileMutation.mutate({
      name: name.trim(),
      email: email.trim(),
    })
  }

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

  const handleCopyId = () => {
    if (!user?.id) return
    navigator.clipboard.writeText(user.id)
    setCopiedId(true)
    toast.success('Account ID copied to clipboard')
    setTimeout(() => setCopiedId(false), 2000)
  }

  // Password validation checks
  const hasMinLength = newPassword.length >= 6
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword
  const canSubmitPassword =
    currentPassword.length > 0 &&
    hasMinLength &&
    passwordsMatch &&
    !changePasswordMutation.isPending

  const activeCertsCount = userCerts.filter((c) => !c.is_revoked).length

  return (
    <div className="space-y-6 max-w-6xl pb-10">
      {/* ─── HEADER & BREADCRUMB ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
            Account & Security
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Administrator Profile</h1>
        <p className="text-xs text-muted-foreground">
          Manage your personal credentials, system identity, and security configuration.
        </p>
      </div>

      {/* ─── HERO PROFILE CARD ─────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-xs">
        {/* Subtle decorative background glow */}
        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-5">
            {/* Avatar with status indicator */}
            <div className="relative shrink-0">
              <div className="w-18 h-18 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-md shadow-violet-500/20 ring-4 ring-card">
                {user?.name ? user.name.charAt(0).toUpperCase() : 'A'}
              </div>
              <span
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-card flex items-center justify-center"
                title="Active Account"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              </span>
            </div>

            {/* Profile Info */}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-bold text-foreground sm:text-2xl">
                  {user?.name ?? 'Administrator'}
                </h2>
                <Badge
                  variant="outline"
                  className="gap-1.5 border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300 font-semibold px-2.5 py-0.5 text-xs shadow-xs"
                >
                  <Shield className="size-3.5" />
                  {user?.role === 'admin' ? 'Super Administrator' : 'Staff Member'}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5 text-muted-foreground/70" />
                  {user?.email ?? 'No email configured'}
                </span>
                {user?.id && (
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted px-2 py-0.5 rounded-md transition-colors cursor-pointer border border-border/50"
                    title="Click to copy UUID"
                  >
                    <Fingerprint className="size-3 text-muted-foreground/70" />
                    <span>{user.id.slice(0, 8)}...{user.id.slice(-4)}</span>
                    {copiedId ? (
                      <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Quick Shortcuts */}
          <div className="flex flex-wrap items-center gap-2 sm:self-center">
            {user?.id && (
              <Link
                to="/users/$userId/certificates"
                params={{ userId: user.id }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors shadow-xs"
              >
                <Key className="size-3.5 text-muted-foreground" />
                VPN Credentials ({activeCertsCount})
              </Link>
            )}
            <Link
              to="/audit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors shadow-xs"
            >
              <FileText className="size-3.5 text-muted-foreground" />
              Audit Trail
            </Link>
          </div>
        </div>

        {/* Bottom Metadata Ribbon */}
        <div className="mt-6 pt-5 border-t border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-muted-foreground block text-[11px]">Account Status</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-0.5">
              <BadgeCheck className="size-3.5" />
              Active & Verified
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">System Role</span>
            <span className="font-semibold text-foreground capitalize mt-0.5 block">
              {user?.role ?? 'admin'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Member Since</span>
            <span className="font-medium text-foreground mt-0.5 block truncate">
              {meUser?.created_at
                ? formatBrowserDateTime(meUser.created_at)
                : 'Initial Setup'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Latest Sign In</span>
            <span className="font-medium text-foreground mt-0.5 block truncate">
              {meUser?.last_login || authStoreUser?.lastLogin
                ? formatBrowserDateTime((meUser?.last_login || authStoreUser?.lastLogin) as string)
                : 'Current Session'}
            </span>
          </div>
        </div>
      </div>

      {/* ─── MAIN 2-COLUMN SECTION ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ─── LEFT COLUMN: PERSONAL DETAILS & TELEMETRY (7 Cols) ─────────── */}
        <div className="lg:col-span-7 space-y-6">
          {/* Card: Personal Details */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b border-border/60 bg-muted/20">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                  <User className="size-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-foreground">Personal Information</h3>
                  <p className="text-xs text-muted-foreground">
                    Update your administrative account identity and communication email
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleUpdateProfile} className="p-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name" className="text-xs font-semibold text-foreground">
                  Full Display Name
                </Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    id="profile-name"
                    type="text"
                    value={name}
                    onChange={(e) => setNameOverride(e.target.value)}
                    placeholder="Enter your full name"
                    className="pl-9 h-9 text-xs"
                    required
                    disabled={isLoadingMe || updateProfileMutation.isPending}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This name will appear on audit logs and team activity records.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="profile-email" className="text-xs font-semibold text-foreground">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    id="profile-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmailOverride(e.target.value)}
                    placeholder="admin@example.com"
                    className="pl-9 h-9 text-xs font-mono"
                    required
                    disabled={isLoadingMe || updateProfileMutation.isPending}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Used for logging into the manager portal and receiving system alerts.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Administrative Privilege
                </Label>
                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Shield className="size-4 text-violet-600 dark:text-violet-400" />
                    <div>
                      <span className="font-semibold text-foreground capitalize">
                        {user?.role ?? 'admin'}
                      </span>
                      <span className="text-muted-foreground ml-1.5">
                        (Full read, write, and orchestration access)
                      </span>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Protected
                  </Badge>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/40">
                {isProfileChanged && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs cursor-pointer"
                    onClick={() => {
                      setNameOverride(null)
                      setEmailOverride(null)
                    }}
                    disabled={updateProfileMutation.isPending}
                  >
                    Reset
                  </Button>
                )}
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 px-4 text-xs font-semibold cursor-pointer shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={!isProfileChanged || updateProfileMutation.isPending}
                >
                  {updateProfileMutation.isPending ? (
                    <>
                      <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                      Saving Changes...
                    </>
                  ) : (
                    <>
                      <Check className="mr-1.5 size-3.5" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>

          {/* Card: Security Telemetry & Session Info */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="flex items-center gap-2.5 p-5 border-b border-border/60 bg-muted/20">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Shield className="size-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Session & Security Telemetry</h3>
                <p className="text-xs text-muted-foreground">
                  Security measures protecting this administrative session
                </p>
              </div>
            </div>

            <div className="p-5 space-y-3.5">
              <div className="flex items-start justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
                <div className="flex items-start gap-2.5">
                  <Fingerprint className="size-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">Session Token & JTI Revocation</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Authenticated via HTTP-Only SameSite cookie protected with cryptographic JTI tokens.
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] text-emerald-600 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                  Enforced
                </Badge>
              </div>

              <div className="flex items-start justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
                <div className="flex items-start gap-2.5">
                  <Clock className="size-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">Rate Limiting Protection</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Sensitive authentication endpoints protected by per-IP rate-limiting algorithms.
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] text-blue-600 dark:text-blue-400 border-blue-500/30 bg-blue-500/10">
                  Active
                </Badge>
              </div>

              <div className="flex items-start justify-between p-3 rounded-lg border border-border/60 bg-muted/20">
                <div className="flex items-start gap-2.5">
                  <Key className="size-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">VPN Client Credentials</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      You currently have {activeCertsCount} active client certificate{activeCertsCount !== 1 ? 's' : ''} assigned to your user account.
                    </p>
                  </div>
                </div>
                {user?.id && (
                  <Link
                    to="/users/$userId/certificates"
                    params={{ userId: user.id }}
                    className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1 shrink-0"
                  >
                    Manage
                    <ExternalLink className="size-3" />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ─── RIGHT COLUMN: SECURITY & PASSWORD (5 Cols) ─────────────────── */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card: Change Password */}
          <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
            <div className="flex items-center gap-2.5 p-5 border-b border-border/60 bg-muted/20">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Lock className="size-4" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Change Password</h3>
                <p className="text-xs text-muted-foreground">
                  Update your authentication password
                </p>
              </div>
            </div>

            <form onSubmit={handleChangePassword} className="p-5 space-y-4">
              {/* Current Password */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="current-password"
                  className="text-xs font-semibold text-foreground"
                >
                  Current Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    id="current-password"
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="pl-9 pr-9 h-9 text-xs"
                    required
                    disabled={changePasswordMutation.isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                    tabIndex={-1}
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-xs font-semibold text-foreground">
                  New Password
                </Label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    id="new-password"
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="pl-9 pr-9 h-9 text-xs"
                    required
                    minLength={6}
                    disabled={changePasswordMutation.isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                    tabIndex={-1}
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                  >
                    {showNew ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="confirm-password"
                  className="text-xs font-semibold text-foreground"
                >
                  Confirm New Password
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground/60 pointer-events-none" />
                  <Input
                    id="confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                    className="pl-9 pr-9 h-9 text-xs"
                    required
                    minLength={6}
                    disabled={changePasswordMutation.isPending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground rounded cursor-pointer"
                    tabIndex={-1}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  >
                    {showConfirm ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              {/* Validation Feedback Indicators */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <div
                    className={`size-3.5 rounded-full flex items-center justify-center text-white ${
                      hasMinLength ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <Check className="size-2.5" />
                  </div>
                  <span
                    className={
                      hasMinLength ? 'text-foreground font-medium' : 'text-muted-foreground'
                    }
                  >
                    Minimum 6 characters in length
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={`size-3.5 rounded-full flex items-center justify-center text-white ${
                      passwordsMatch ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <Check className="size-2.5" />
                  </div>
                  <span
                    className={
                      passwordsMatch ? 'text-foreground font-medium' : 'text-muted-foreground'
                    }
                  >
                    New passwords match
                  </span>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full text-xs font-semibold cursor-pointer shadow-xs"
                disabled={!canSubmitPassword}
              >
                {changePasswordMutation.isPending ? (
                  <>
                    <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                    Updating Password...
                  </>
                ) : (
                  <>
                    <Key className="mr-1.5 size-3.5" />
                    Update Password
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* ─── BOTTOM SECTION: RECENT AUDIT ACTIVITY FEED ─────────────────────── */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-xs overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Activity className="size-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground">Recent Administrative Actions</h3>
              <p className="text-xs text-muted-foreground">
                Audit trail of recent configuration and security operations performed by your account
              </p>
            </div>
          </div>
          <Link
            to="/audit"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            View All Audit Logs
            <ExternalLink className="size-3" />
          </Link>
        </div>

        <div className="divide-y divide-border/60">
          {isLoadingLogs ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
                <Skeleton className="h-4 w-28" />
              </div>
            ))
          ) : recentLogs.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-2.5 text-muted-foreground/60">
                <FileText className="size-5" />
              </div>
              <p className="text-xs font-medium text-foreground">No recent activity recorded</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Administrative operations performed by your user will automatically be logged here.
              </p>
            </div>
          ) : (
            recentLogs.map((log) => {
              const meta = getActionMeta(log.action)
              return (
                <div
                  key={log.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted/60 text-muted-foreground border border-border/50 shrink-0">
                      <FileText className="size-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`font-mono text-[10px] px-1.5 py-0 ${meta.className}`}
                        >
                          {meta.label}
                        </Badge>
                        <span className="text-xs font-medium text-foreground capitalize">
                          {log.resource_type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        {log.ip_address && (
                          <span className="flex items-center gap-1 font-mono">
                            <Globe className="size-3" />
                            {log.ip_address}
                          </span>
                        )}
                        {log.resource_id && (
                          <span className="font-mono text-[10px] text-muted-foreground/70">
                            ID: {log.resource_id.slice(0, 8)}...
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-1.5 self-end sm:self-center">
                    <Clock className="size-3" />
                    {formatBrowserDateTime(log.created_at)}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
