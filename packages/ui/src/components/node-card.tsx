import React from 'react'
import { StatusBadge } from './status-badge'
import { formatBrowserDateTime, type VpnNode } from '@vpn/shared'

interface NodeCardProps {
  node: VpnNode
  onClick?: () => void
}

export function NodeCard({ node, onClick }: NodeCardProps) {
  return (
    <div
      className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{node.hostname}</h3>
          <p className="text-sm text-gray-500">{node.ip_address}:{node.port}</p>
        </div>
        <StatusBadge status={node.status} />
      </div>
      {node.region && (
        <p className="text-xs text-gray-400">📍 {node.region}</p>
      )}
      {node.last_seen && (
        <p className="text-xs text-gray-400 mt-1">
          Last seen: {formatBrowserDateTime(node.last_seen)}
        </p>
      )}
    </div>
  )
}
