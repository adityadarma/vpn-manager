import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_layout/groups')({
  component: GroupsPage,
})

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Plus, Trash2, Users, Network, Pencil, ChevronRight, UserPlus, NetworkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Group {
  id: string
  name: string
  description: string | null
  vpn_subnet: string | null
  member_count: number
  network_count: number
  created_at: string
}

interface GroupDetail extends Group {
  members: Array<{ id: string; username: string; email: string | null; role: string; is_active: boolean; vpn_ip: string | null }>
  networks: Array<{ id: string; name: string; cidr: string }>
}

interface User {
  id: string
  username: string
  email: string | null
  role: string
  is_active: boolean
}

interface NetworkItem {
  id: string
  name: string
  cidr: string
  description: string | null
}

interface FormState { name: string; description: string; vpn_subnet: string }

function GroupsPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [editGroup, setEditGroup] = useState<Group | null>(null)
  const [detailGroup, setDetailGroup] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>({ name: '', description: '', vpn_subnet: '' })
  const [showAddMember, setShowAddMember] = useState(false)
  const [showAddNetwork, setShowAddNetwork] = useState(false)
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set())
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())

  const { data: groups = [], isLoading } = useQuery<Group[]>({
    queryKey: ['groups'],
    queryFn: () => api.get('/api/v1/groups'),
  })

  const { data: groupDetail } = useQuery<GroupDetail>({
    queryKey: ['groups', detailGroup],
    queryFn: () => api.get(`/api/v1/groups/${detailGroup}`),
    enabled: !!detailGroup,
  })

  const { data: allUsers = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => api.get('/api/v1/users'),
  })

  const { data: allNetworks = [] } = useQuery<NetworkItem[]>({
    queryKey: ['networks'],
    queryFn: () => api.get('/api/v1/networks'),
  })

  const createMutation = useMutation({
    mutationFn: (data: FormState) => api.post<Group>('/api/v1/groups', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setShowCreate(false)
      setForm({ name: '', description: '', vpn_subnet: '' })
      toast.success('Group created successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormState }) =>
      api.patch<Group>(`/api/v1/groups/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setEditGroup(null)
      toast.success('Group updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/groups/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      if (detailGroup) setDetailGroup(null)
      toast.success('Group deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => api.delete(`/api/v1/groups/${id}`)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setSelectedGroups(new Set())
      if (detailGroup) setDetailGroup(null)
      toast.success('Groups deleted successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleGroup = (groupId: string) => {
    const newSelected = new Set(selectedGroups)
    if (newSelected.has(groupId)) {
      newSelected.delete(groupId)
    } else {
      newSelected.add(groupId)
    }
    setSelectedGroups(newSelected)
  }

  const toggleAll = () => {
    if (selectedGroups.size === groups.length) {
      setSelectedGroups(new Set())
    } else {
      setSelectedGroups(new Set(groups.map(g => g.id)))
    }
  }

  const handleBulkDelete = () => {
    if (confirm(`Delete ${selectedGroups.size} group(s)?`)) {
      bulkDeleteMutation.mutate(Array.from(selectedGroups))
    }
  }

  const addMemberMutation = useMutation({
    mutationFn: async ({ groupId, userIds }: { groupId: string; userIds: string[] }) => {
      await Promise.all(userIds.map(id => api.post(`/api/v1/groups/${groupId}/members`, { user_id: id })))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setShowAddMember(false)
      setSelectedUserIds(new Set())
      setSearchQuery('')
      toast.success('Members added to group')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeMemberMutation = useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.delete(`/api/v1/groups/${groupId}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      toast.success('Member removed from group')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addNetworkMutation = useMutation({
    mutationFn: async ({ groupId, networkIds }: { groupId: string; networkIds: string[] }) => {
      await Promise.all(networkIds.map(id => api.post(`/api/v1/groups/${groupId}/networks`, { network_id: id })))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setShowAddNetwork(false)
      setSelectedNetworkIds(new Set())
      setSearchQuery('')
      toast.success('Networks assigned to group')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeNetworkMutation = useMutation({
    mutationFn: ({ groupId, networkId }: { groupId: string; networkId: string }) =>
      api.delete(`/api/v1/groups/${groupId}/networks/${networkId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      toast.success('Network removed from group')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openEdit = (g: Group) => {
    setEditGroup(g)
    setForm({ name: g.name, description: g.description ?? '', vpn_subnet: g.vpn_subnet ?? '' })
  }

  // Filter users that are not already in the group and match search
  const availableUsers = allUsers.filter(u => 
    !groupDetail?.members.some(m => m.id === u.id) &&
    (u.username.toLowerCase().includes(searchQuery.toLowerCase()) || 
     (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase())))
  )

  // Filter networks that are not already assigned to the group and match search
  const availableNetworks = allNetworks.filter(n => 
    !groupDetail?.networks.some(net => net.id === n.id) &&
    (n.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
     n.cidr.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const toggleUserId = (id: string) => {
    const newSelected = new Set(selectedUserIds)
    if (newSelected.has(id)) newSelected.delete(id)
    else newSelected.add(id)
    setSelectedUserIds(newSelected)
  }

  const toggleNetworkId = (id: string) => {
    const newSelected = new Set(selectedNetworkIds)
    if (newSelected.has(id)) newSelected.delete(id)
    else newSelected.add(id)
    setSelectedNetworkIds(newSelected)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Groups</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {groups.length} group{groups.length !== 1 ? 's' : ''} created
            {selectedGroups.size > 0 && ` • ${selectedGroups.size} selected`}
          </p>
        </div>
        <div className="flex gap-2">
          {selectedGroups.size > 0 && (
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete ({selectedGroups.size})
            </Button>
          )}
          <Button id="btn-create-group" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setShowCreate(true); setForm({ name: '', description: '', vpn_subnet: '' }) }}>
            <Plus className="mr-2 h-4 w-4" />
            Add Group
          </Button>
        </div>
      </div>

      {/* Detail panel + table side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Groups table */}
        <div className={detailGroup ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">All Groups</CardTitle>
              <CardDescription>{groups.length} group{groups.length !== 1 ? 's' : ''}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
              ) : groups.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No groups yet. Create one to start organizing your VPN users.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <input
                          type="checkbox"
                          checked={groups.length > 0 && selectedGroups.size === groups.length}
                          onChange={toggleAll}
                          className="rounded border-input text-emerald-600 focus:ring-emerald-500"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Subnet / IP Pool</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-center">Members</TableHead>
                      <TableHead className="text-center">Networks</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => (
                      <TableRow
                        key={g.id}
                        className={`cursor-pointer hover:bg-muted/50 ${detailGroup === g.id ? 'bg-muted' : ''}`}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedGroups.has(g.id)}
                            onChange={() => toggleGroup(g.id)}
                            className="rounded border-input text-emerald-600 focus:ring-emerald-500"
                          />
                        </TableCell>
                        <TableCell className="font-medium" onClick={() => setDetailGroup(detailGroup === g.id ? null : g.id)}>{g.name}</TableCell>
                        <TableCell onClick={() => setDetailGroup(detailGroup === g.id ? null : g.id)}>
                          {g.vpn_subnet
                            ? <code className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded">{g.vpn_subnet}</code>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm" onClick={() => setDetailGroup(detailGroup === g.id ? null : g.id)}>{g.description ?? '—'}</TableCell>
                        <TableCell className="text-center" onClick={() => setDetailGroup(detailGroup === g.id ? null : g.id)}>
                          <Badge variant="secondary">{g.member_count}</Badge>
                        </TableCell>
                        <TableCell className="text-center" onClick={() => setDetailGroup(detailGroup === g.id ? null : g.id)}>
                          <Badge variant="outline">{g.network_count}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              id={`btn-edit-group-${g.id}`} 
                              onClick={(e) => { e.stopPropagation(); openEdit(g); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              id={`btn-delete-group-${g.id}`}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(g.id); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${detailGroup === g.id ? 'rotate-90' : ''}`} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detail panel */}
        {detailGroup && groupDetail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b">
              <h3 className="font-semibold text-lg">{groupDetail.name} Details</h3>
              <Button variant="ghost" size="icon" onClick={() => setDetailGroup(null)} className="h-8 w-8">
                <span className="sr-only">Close</span>
                <Trash2 className="h-4 w-4 hidden" /> {/* Dummy icon so imports don't break, we'll just use an X text or lucide X */}
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-x h-4 w-4"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </Button>
            </div>

            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  Networks
                  <Badge className="ml-2">{groupDetail.networks.length}</Badge>
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => { setShowAddNetwork(true); setSearchQuery('') }}
                >
                  <NetworkIcon className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {groupDetail.networks.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No networks assigned.</p>
                ) : (
                  <div className="divide-y max-h-[400px] overflow-y-auto">
                    {groupDetail.networks.map(n => (
                      <div key={n.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{n.name}</p>
                          <code className="text-xs text-muted-foreground">{n.cidr}</code>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                          onClick={() => removeNetworkMutation.mutate({ groupId: detailGroup, networkId: n.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Members
                  <Badge className="ml-2">{groupDetail.members.length}</Badge>
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => { setShowAddMember(true); setSearchQuery('') }}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  Add
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {groupDetail.members.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No members yet.</p>
                ) : (
                  <div className="divide-y max-h-[500px] overflow-y-auto">
                    {groupDetail.members.map(m => (
                      <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                          {m.username[0]?.toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.username}</p>
                          <p className="text-xs text-muted-foreground truncate">{m.email ?? '—'}</p>
                        </div>
                        {m.vpn_ip && (
                          <code className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded hidden sm:inline-block">
                            {m.vpn_ip}
                          </code>
                        )}
                        <Badge variant={m.is_active ? 'default' : 'secondary'} className="text-xs hidden md:inline-flex">
                          {m.is_active ? 'active' : 'inactive'}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50 shrink-0"
                          onClick={() => removeMemberMutation.mutate({ groupId: detailGroup, userId: m.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Name</Label>
              <Input
                id="group-name"
                placeholder="e.g. IT Department"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-subnet">VPN Subnet <span className="text-red-500">*</span></Label>
              <Input
                id="group-subnet"
                placeholder="e.g. 10.8.1.0/24"
                value={form.vpn_subnet}
                onChange={e => setForm(f => ({ ...f, vpn_subnet: e.target.value }))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Users in this group will be auto-assigned an IP from this subnet.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-desc">Description</Label>
              <Textarea
                id="group-desc"
                placeholder="Optional description"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              id="btn-create-group-submit"
              disabled={!form.name.trim() || !form.vpn_subnet.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: form.name, description: form.description, vpn_subnet: form.vpn_subnet || '' })}
            >
              {createMutation.isPending ? 'Adding...' : 'Add Group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editGroup} onOpenChange={() => setEditGroup(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-group-name">Name</Label>
              <Input
                id="edit-group-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-group-subnet">VPN Subnet <span className="text-red-500">*</span></Label>
              <Input
                id="edit-group-subnet"
                placeholder="e.g. 10.8.1.0/24"
                value={form.vpn_subnet}
                onChange={e => setForm(f => ({ ...f, vpn_subnet: e.target.value }))}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Changing the subnet does not reassign existing user IPs.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-group-desc">Description</Label>
              <Textarea
                id="edit-group-desc"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroup(null)}>Cancel</Button>
            <Button
              id="btn-edit-group-submit"
              disabled={!form.name.trim() || !form.vpn_subnet.trim() || updateMutation.isPending}
              onClick={() => editGroup && updateMutation.mutate({ id: editGroup.id, data: { name: form.name, description: form.description, vpn_subnet: form.vpn_subnet || '' } })}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Member Dialog (Multi-Select) */}
      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Add Members to {groupDetail?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <Input
                placeholder="Search by username or email..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {availableUsers.length === 0 ? (
                   <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
                     No users found to add.
                   </div>
                ) : (
                  availableUsers.map(u => (
                    <div 
                      key={u.id} 
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer select-none transition-colors hover:bg-muted/50 ${selectedUserIds.has(u.id) ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border'}`}
                      onClick={() => toggleUserId(u.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.has(u.id)}
                        onChange={() => {}} // handled by parent div click
                        className="rounded border-input text-emerald-600 focus:ring-emerald-500 h-4 w-4 shrink-0 transition-opacity"
                      />
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                        {u.username[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{u.username}</p>
                        {u.email && <p className="text-xs text-muted-foreground truncate">{u.email}</p>}
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase font-semibold text-muted-foreground">
                        {u.role}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex items-center sm:justify-between w-full">
             <div className="text-sm text-muted-foreground hidden sm:block">
               {selectedUserIds.size} user(s) selected
             </div>
             <div className="flex gap-2">
               <Button variant="outline" onClick={() => { setShowAddMember(false); setSelectedUserIds(new Set()) }}>
                 Cancel
               </Button>
               <Button
                 disabled={selectedUserIds.size === 0 || addMemberMutation.isPending}
                 onClick={() => detailGroup && addMemberMutation.mutate({ groupId: detailGroup, userIds: Array.from(selectedUserIds) })}
                 className={selectedUserIds.size > 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
               >
                 {addMemberMutation.isPending ? 'Adding...' : `Add ${selectedUserIds.size || ''} Member(s)`}
               </Button>
             </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Network Dialog (Multi-Select) */}
      <Dialog open={showAddNetwork} onOpenChange={setShowAddNetwork}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Assign Networks to {groupDetail?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <Input
                placeholder="Search network name or CIDR..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {availableNetworks.length === 0 ? (
                   <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg border-dashed">
                     No networks found to assign.
                   </div>
                ) : (
                  availableNetworks.map(n => (
                    <div 
                      key={n.id} 
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer select-none transition-colors hover:bg-muted/50 ${selectedNetworkIds.has(n.id) ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border'}`}
                      onClick={() => toggleNetworkId(n.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedNetworkIds.has(n.id)}
                        onChange={() => {}} // handled by parent div click
                        className="rounded border-input text-emerald-600 focus:ring-emerald-500 h-4 w-4 shrink-0 transition-opacity"
                      />
                      <div className="h-8 w-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                        <NetworkIcon className="h-4 w-4 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{n.name}</p>
                        <p className="text-xs font-mono text-muted-foreground truncate">{n.cidr}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex items-center sm:justify-between w-full">
             <div className="text-sm text-muted-foreground hidden sm:block">
               {selectedNetworkIds.size} network(s) selected
             </div>
             <div className="flex gap-2">
               <Button variant="outline" onClick={() => { setShowAddNetwork(false); setSelectedNetworkIds(new Set()) }}>
                 Cancel
               </Button>
               <Button
                 disabled={selectedNetworkIds.size === 0 || addNetworkMutation.isPending}
                 onClick={() => detailGroup && addNetworkMutation.mutate({ groupId: detailGroup, networkIds: Array.from(selectedNetworkIds) })}
                 className={selectedNetworkIds.size > 0 ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
               >
                 {addNetworkMutation.isPending ? 'Assigning...' : `Assign ${selectedNetworkIds.size || ''} Network(s)`}
               </Button>
             </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
