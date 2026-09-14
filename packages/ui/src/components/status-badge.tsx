import React from 'react'

type Status = 'online' | 'offline' | 'unknown' | 'active' | 'revoked' | 'pending' | 'done' | 'failed' | 'running' | 'decommissioned'

const STATUS_STYLES: Record<Status, { bg: string; text: string; dot: string }> = {
  online:  { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  active:  { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  done:    { bg: 'bg-emerald-100', text: 'text-emerald-800', dot: 'bg-emerald-500' },
  offline: { bg: 'bg-red-100',     text: 'text-red-800',     dot: 'bg-red-500' },
  failed:  { bg: 'bg-red-100',     text: 'text-red-800',     dot: 'bg-red-500' },
  revoked: { bg: 'bg-red-100',     text: 'text-red-800',     dot: 'bg-red-500' },
  unknown: { bg: 'bg-gray-100',    text: 'text-gray-800',    dot: 'bg-gray-400' },
  pending: { bg: 'bg-yellow-100',  text: 'text-yellow-800',  dot: 'bg-yellow-500' },
  running: { bg: 'bg-blue-100',    text: 'text-blue-800',    dot: 'bg-blue-500' },
  decommissioned: { bg: 'bg-amber-100', text: 'text-amber-800', dot: 'bg-amber-500' },
}

interface StatusBadgeProps {
  status: Status
  label?: string
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unknown

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {label ?? status}
    </span>
  )
}
