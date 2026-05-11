'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import {
  addOwnerMember,
  removeOwnerMember,
  updateOwnerMemberRole,
} from '@/actions/owner-entity-actions'
import {
  Building2, Loader2, Users, Plus, X, AlertCircle, Search,
  CheckCircle2, ShieldCheck, Eye,
} from 'lucide-react'

// ────────────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────────────

type MemberRole = 'admin' | 'viewer'

type OwnerEntity = {
  id: string
  full_name: string
  email: string | null
  company_name: string | null
  property_count: number
  member_count: number
}

type EntityMember = {
  id: string
  owner_id: string
  user_id: string
  member_role: MemberRole
  granted_at: string
  full_name: string | null
  email: string | null
  profile_role: string | null
  is_active: boolean
}

type AssignableUser = {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
}

const ROLE_BADGE: Record<string, string> = {
  Admin: 'bg-purple-50 text-purple-600',
  'Property Manager': 'bg-blue-50 text-blue-600',
  Accounting: 'bg-amber-50 text-amber-600',
  Owner: 'bg-indigo-50 text-indigo-600',
  Maintenance: 'bg-orange-50 text-orange-600',
  Vendor: 'bg-slate-100 text-slate-600',
  Tenant: 'bg-green-50 text-green-600',
}


// ────────────────────────────────────────────────────────────────────────────
// PAGE
// ────────────────────────────────────────────────────────────────────────────

export default function OwnerAccessPage() {
  const [owners, setOwners] = useState<OwnerEntity[]>([])
  const [members, setMembers] = useState<EntityMember[]>([])
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [loading, setLoading] = useState(true)

  // Selection
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null)

  // Add-member form state
  const [addOpen, setAddOpen] = useState(false)
  const [pendingUserId, setPendingUserId] = useState<string | null>(null)
  const [pendingRole, setPendingRole] = useState<MemberRole>('viewer')
  const [userSearch, setUserSearch] = useState('')

  // Action busy
  const [busyAction, setBusyAction] = useState<string | null>(null)


  // ── FETCH ALL DATA ─────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)

    const [
      { data: ownerRows, error: oErr },
      { data: memberRows, error: mErr },
      { data: userRows, error: uErr },
      { data: propertyRows },
    ] = await Promise.all([
      supabase
        .from('owners')
        .select('id, full_name, email, company_name')
        .order('full_name', { ascending: true }),
      // No embedded select — owner_entity_members.user_id references auth.users
      // not public.profiles, so PostgREST can't auto-resolve the join. We
      // fetch profiles separately and merge in JS below.
      supabase
        .from('owner_entity_members')
        .select('id, owner_id, user_id, member_role, granted_at')
        .order('granted_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active')
        .order('full_name', { ascending: true }),
      supabase
        .from('properties')
        .select('id, owner_id'),
    ])

    if (oErr) console.error('owners fetch error:', oErr)
    if (mErr) console.error('members fetch error:', mErr)
    if (uErr) console.error('users fetch error:', uErr)

    // Index profiles by user id for the merge below
    const profileByUserId = new Map<string, { full_name: string | null; email: string | null; role: string | null; is_active: boolean }>()
    for (const p of (userRows ?? [])) {
      profileByUserId.set(p.id, {
        full_name: p.full_name,
        email: p.email,
        role: p.role,
        is_active: p.is_active !== false,
      })
    }

    // Counts: properties per owner, members per owner
    const propCount = new Map<string, number>()
    for (const p of (propertyRows ?? [])) {
      if (!p.owner_id) continue
      propCount.set(p.owner_id, (propCount.get(p.owner_id) ?? 0) + 1)
    }
    const memberCount = new Map<string, number>()
    for (const m of (memberRows ?? [])) {
      memberCount.set(m.owner_id, (memberCount.get(m.owner_id) ?? 0) + 1)
    }

    setOwners(
      (ownerRows ?? []).map((o: any) => ({
        id: o.id,
        full_name: o.full_name,
        email: o.email,
        company_name: o.company_name,
        property_count: propCount.get(o.id) ?? 0,
        member_count:   memberCount.get(o.id) ?? 0,
      }))
    )

    setMembers(
      (memberRows ?? []).map((m: any) => {
        const p = profileByUserId.get(m.user_id) ?? null
        return {
          id: m.id,
          owner_id: m.owner_id,
          user_id: m.user_id,
          member_role: m.member_role,
          granted_at: m.granted_at,
          full_name:    p?.full_name ?? null,
          email:        p?.email ?? null,
          profile_role: p?.role ?? null,
          is_active:    p?.is_active ?? true,
        }
      })
    )

    setUsers(
      (userRows ?? []).map((u: any) => ({
        ...u,
        is_active: u.is_active !== false,
      }))
    )

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])


  // ── DERIVED ─────────────────────────────────────────────────────────────

  const selectedOwner = useMemo(
    () => owners.find((o) => o.id === selectedOwnerId) ?? null,
    [owners, selectedOwnerId]
  )

  // ── ACTIONS ──────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!selectedOwner || !pendingUserId) return
    setBusyAction('add')
    const result = await addOwnerMember({
      ownerId: selectedOwner.id,
      userId: pendingUserId,
      memberRole: pendingRole,
    })
    if (result.success) {
      toast.success(result.message)
      setAddOpen(false)
      setPendingUserId(null)
      setPendingRole('viewer')
      setUserSearch('')
      await fetchAll()
    } else {
      toast.error(result.message)
    }
    setBusyAction(null)
  }

  const handleRemove = async (memberId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from this owner entity? They will lose portal access immediately.`)) return
    setBusyAction(`remove-${memberId}`)
    const result = await removeOwnerMember(memberId)
    if (result.success) {
      toast.success(result.message)
      await fetchAll()
    } else {
      toast.error(result.message)
    }
    setBusyAction(null)
  }

  const handleToggleRole = async (memberId: string, currentRole: MemberRole) => {
    const newRole: MemberRole = currentRole === 'admin' ? 'viewer' : 'admin'
    setBusyAction(`role-${memberId}`)
    const result = await updateOwnerMemberRole({ memberId, memberRole: newRole })
    if (result.success) {
      toast.success(result.message)
      await fetchAll()
    } else {
      toast.error(result.message)
    }
    setBusyAction(null)
  }


  // ── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex items-center gap-4">
        <div className="p-4 bg-emerald-100 text-emerald-700 rounded-2xl">
          <Building2 size={32} />
        </div>
        <div>
          <h1 className="text-3xl font-black italic uppercase text-slate-900">Owner Portal Access</h1>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">
            Link users to owner entities so they can see that entity&apos;s properties in the owner portal
          </p>
        </div>
      </div>

      {/* INFO BANNER */}
      <div className="flex gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-sm text-slate-700">
        <AlertCircle size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold mb-1">How owner entity membership works</p>
          <ul className="list-disc list-inside space-y-0.5 text-slate-600">
            <li>An <strong>owner entity</strong> is a legal owner of one or more properties (LLC, individual, trust). Manage entities themselves at <a href="/admin/owners" className="text-emerald-600 font-bold hover:underline">/admin/owners</a>.</li>
            <li>A <strong>member</strong> is an auth user who can see that entity&apos;s properties in the owner portal. One user can be a member of multiple entities.</li>
            <li><strong>admin</strong> members can edit the owner entity record (contact info, etc.). <strong>viewer</strong> members are read-only.</li>
            <li>For one-off "user can see Property X" grants without membership, use <a href="/admin/settings/access" className="text-emerald-600 font-bold hover:underline">/admin/settings/access</a> instead.</li>
          </ul>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT: OWNER LIST */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-2">
              <Users size={18} className="text-emerald-600" />
              <h2 className="text-sm font-black italic uppercase tracking-wider">Owner entities</h2>
              {!loading && (
                <span className="ml-auto text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {owners.length}
                </span>
              )}
            </div>

            {loading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : owners.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                No owner entities yet.
                <a href="/admin/owners" className="block mt-2 text-emerald-600 font-bold hover:underline">
                  Create one at /admin/owners →
                </a>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {owners.map((o) => {
                  const isSelected = selectedOwnerId === o.id
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedOwnerId(o.id)}
                        className={`w-full text-left px-6 py-4 transition-colors ${
                          isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-900 truncate">{o.full_name}</p>
                            {o.company_name && (
                              <p className="text-[11px] text-slate-500 truncate">{o.company_name}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className="text-[10px] font-black text-slate-400">
                              {o.member_count} member{o.member_count !== 1 ? 's' : ''}
                            </span>
                            <span className="text-[10px] font-bold text-slate-300">
                              {o.property_count} prop{o.property_count !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT: MEMBER DETAIL */}
        <div className="lg:col-span-2">
          {!selectedOwner ? (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-12 text-center text-slate-400">
              <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-bold">Select an owner entity on the left to manage its members.</p>
            </div>
          ) : (
            <OwnerDetail
              owner={selectedOwner}
              allMembers={members}
              allUsers={users}
              busyAction={busyAction}
              addOpen={addOpen}
              setAddOpen={setAddOpen}
              pendingUserId={pendingUserId}
              setPendingUserId={setPendingUserId}
              pendingRole={pendingRole}
              setPendingRole={setPendingRole}
              userSearch={userSearch}
              setUserSearch={setUserSearch}
              onAdd={handleAdd}
              onRemove={handleRemove}
              onToggleRole={handleToggleRole}
            />
          )}
        </div>
      </div>
    </div>
  )
}


// ────────────────────────────────────────────────────────────────────────────
// DETAIL COMPONENT (separate so the parent stays readable)
// ────────────────────────────────────────────────────────────────────────────

function OwnerDetail(props: {
  owner: OwnerEntity
  allMembers: EntityMember[]
  allUsers: AssignableUser[]
  busyAction: string | null
  addOpen: boolean
  setAddOpen: (b: boolean) => void
  pendingUserId: string | null
  setPendingUserId: (id: string | null) => void
  pendingRole: MemberRole
  setPendingRole: (r: MemberRole) => void
  userSearch: string
  setUserSearch: (s: string) => void
  onAdd: () => void
  onRemove: (memberId: string, memberName: string) => void
  onToggleRole: (memberId: string, currentRole: MemberRole) => void
}) {
  const {
    owner, allMembers, allUsers, busyAction,
    addOpen, setAddOpen, pendingUserId, setPendingUserId,
    pendingRole, setPendingRole, userSearch, setUserSearch,
    onAdd, onRemove, onToggleRole,
  } = props

  // Members for the selected owner entity
  const membersForOwner = useMemo(
    () => allMembers.filter((m) => m.owner_id === owner.id),
    [allMembers, owner.id]
  )

  // Existing member user_ids for filtering the picker
  const existingUserIds = useMemo(
    () => new Set(membersForOwner.map((m) => m.user_id)),
    [membersForOwner]
  )

  // Eligible users for adding: active, not already a member
  const eligibleUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return allUsers
      .filter((u) => u.is_active && !existingUserIds.has(u.id))
      .filter((u) => {
        if (!q) return true
        return [u.full_name, u.email, u.role].some((s) => (s || '').toLowerCase().includes(q))
      })
      .slice(0, 50)   // cap so the dropdown doesn't blow up
  }, [allUsers, existingUserIds, userSearch])

  return (
    <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">

      {/* PANEL HEADER */}
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black italic uppercase">{owner.full_name}</h2>
            {owner.company_name && (
              <p className="text-[11px] text-slate-500">{owner.company_name}</p>
            )}
            {owner.email && (
              <p className="text-[11px] text-slate-400 mt-0.5">{owner.email}</p>
            )}
          </div>
          <a
            href="/admin/owners"
            className="px-3 py-1.5 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg text-[10px] font-black uppercase tracking-wider"
          >
            Edit Entity →
          </a>
        </div>
        <div className="mt-3 flex gap-3 text-xs font-bold text-slate-500">
          <span>{owner.member_count} member{owner.member_count !== 1 ? 's' : ''}</span>
          <span className="text-slate-300">•</span>
          <span>{owner.property_count} propert{owner.property_count !== 1 ? 'ies' : 'y'}</span>
        </div>
      </div>

      {/* MEMBER LIST */}
      <div className="px-6 py-5 space-y-2">
        {membersForOwner.length === 0 ? (
          <div className="text-sm text-slate-400 italic py-4">
            No members yet — add one below.
          </div>
        ) : (
          membersForOwner.map((m) => {
            const isBusy = busyAction === `remove-${m.id}` || busyAction === `role-${m.id}`
            const displayName = m.full_name || m.email || m.user_id
            return (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 rounded-xl">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-sm text-slate-900 truncate">{displayName}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {m.email && <p className="text-[11px] text-slate-500 truncate">{m.email}</p>}
                    {m.profile_role && (
                      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${ROLE_BADGE[m.profile_role] ?? 'bg-blue-50 text-blue-600'}`}>
                        {m.profile_role}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleRole(m.id, m.member_role)}
                    disabled={isBusy}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-colors ${
                      m.member_role === 'admin'
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                    title={`Change to ${m.member_role === 'admin' ? 'viewer' : 'admin'}`}
                  >
                    {m.member_role === 'admin' ? <ShieldCheck size={10} /> : <Eye size={10} />}
                    {m.member_role}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(m.id, displayName)}
                    disabled={isBusy}
                    className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
                    title="Remove member"
                  >
                    {busyAction === `remove-${m.id}` ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ADD MEMBER */}
      <div className="px-6 py-5 border-t border-slate-100">
        {!addOpen ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full px-4 py-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={16} />
            Add member
          </button>
        ) : (
          <div className="space-y-3 p-4 bg-slate-50 rounded-xl">
            {/* Role picker */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Role:</span>
              {(['viewer', 'admin'] as MemberRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setPendingRole(r)}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-colors ${
                    pendingRole === r
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-white text-slate-500 hover:bg-slate-100'
                  }`}
                >
                  {r === 'admin' ? <ShieldCheck size={10} /> : <Eye size={10} />}
                  {r}
                </button>
              ))}
            </div>

            {/* User search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users by name, email, or role..."
                className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            {/* User list */}
            <ul className="max-h-60 overflow-y-auto bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
              {eligibleUsers.length === 0 ? (
                <li className="p-4 text-sm text-slate-400 text-center">No matching users.</li>
              ) : (
                eligibleUsers.map((u) => {
                  const selected = pendingUserId === u.id
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setPendingUserId(u.id)}
                        className={`w-full text-left px-4 py-2 flex items-center gap-2 ${
                          selected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        {selected && <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />}
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm text-slate-900 truncate">{u.full_name || u.email}</p>
                          <p className="text-[11px] text-slate-500 truncate">{u.email}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${ROLE_BADGE[u.role] ?? 'bg-blue-50 text-blue-600'}`}>
                          {u.role}
                        </span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onAdd}
                disabled={!pendingUserId || busyAction !== null}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
              >
                {busyAction === 'add' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                Add member
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddOpen(false)
                  setPendingUserId(null)
                  setPendingRole('viewer')
                  setUserSearch('')
                }}
                className="px-4 py-2 bg-white text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
