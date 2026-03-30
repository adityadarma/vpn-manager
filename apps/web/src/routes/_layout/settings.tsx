import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/settings')({
  component: SettingsPage,
})

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { toast } from 'sonner'
import { Save, Settings, AlertCircle } from 'lucide-react'

interface Setting {
  key: string
  value: string | null
  description?: string
}

function SettingsPage() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [mounted, setMounted] = useState(false)
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => { setMounted(true) }, [])

  const { data: settings = [] } = useQuery<Setting[]>({
    queryKey: ['settings'],
    queryFn: () => api.get('/api/v1/settings'),
  })

  const settingValues = settings.reduce<Record<string, string>>((acc, s) => {
    acc[s.key] = values[s.key] ?? s.value ?? ''
    return acc
  }, {})

  const saveMutation = useMutation({
    mutationFn: () => api.post('/api/v1/settings', settingValues),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Settings saved')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const isAdmin = mounted && user?.role === 'admin'

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">System configuration</p>
      </div>

      {/* System Settings */}
      <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm">
        <div className="px-5 py-4 border-b border-border/50 flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground/70" />
          <h2 className="font-semibold text-foreground">System Configuration</h2>
        </div>
        <div className="p-5">
          {!isAdmin && mounted && (
            <div className="mb-5 flex items-start gap-3 p-4 bg-amber-50 rounded-lg border border-amber-100">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Read-only access</p>
                <p className="text-xs text-amber-600 mt-0.5">Only administrators can modify system settings.</p>
              </div>
            </div>
          )}

          {settings.length === 0 ? (
            <p className="text-sm text-muted-foreground/70 text-center py-8">No configurable settings.</p>
          ) : (
            <div className="space-y-5">
              {settings.map((s) => (
                <div key={s.key}>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    {s.key}
                    {s.description && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground/70">{s.description}</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={settingValues[s.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [s.key]: e.target.value })}
                    disabled={!isAdmin}
                    className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-muted/50"
                  />
                </div>
              ))}
            </div>
          )}

          {isAdmin && settings.length > 0 && (
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
