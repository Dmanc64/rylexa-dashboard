'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import {
  grantPropertyAccess,
  revokePropertyAccess,
  bulkGrantPropertyAccess,
  bulkRevokePropertyAccess,
} from '@/actions/property-access-actions'
import {
  Shield, Loader2, Users, Building2, Plus, X,
  CheckCircle2, Search, ChevronDown, AlertCircle,
} from 'lucide-react'

// ────────────────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────────────────

type AccessLevel = 'Property Manager' | 'Accounting' | 'Owner'
type PermissionTier = 'full' | 'read'

type AssignableUser = {
  id: string
  full_name: string
  email: string
  role: AccessLevel
  is_active: boolean
}

type Property = {
  id: string
  name: string
  city: string | null
}

type AccessRow = {
  id: string
  property_id: string
  access_level: AccessLevel
  permission_tier: PermissionTier
  granted_at: string
  expires_at: string | null
  notes: string | null
}

// Roles eligible for per-property grants. Admin bypasses; M/V/T scope elsewhere.
const ASSIGNABLE_ROLES: AccessLevel[] = ['Property Manager', 'Accounting', 'Owner']

const ROLE_BADGE: Record<AccessLevel, string> = {
  'Property Manager': 'bg-blue-50 text-blue-600',
  'Accounting': 'bg-amber-50 text-amber-600',
  'Owner': 'bg-indigo-50 text-indigo-600',
}


// ────────────────────────────────────────────────────────────────────────────
// PAGE
// ────────────────────────────────────────────────────────────────────────────

export default function PropertyAccessPage() {
  // master data
  const [users, setUsers] = useState<AssignableUser[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [accessByUser, setAccessByUser] = useState<Record<string, AccessRow[]>>({})
  const [loading, setLoading] = useState(true)

  // selection state
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  // add-property combobox state (right panel)
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false)
  const [propertySearch, setPropertySearch] = useState('')
  const [pendingPropertyId, setPendingPropertyId] = useState<string | null>(null)
  const [pendingTier, setPendingTier] = useState<PermissionTier>('full')

  // action busy state
  const [busyAction, setBusyAction] = useState<string | null>(null) // e.g., "grant-<id>", "revoke-<id>", "bulk-grant", "bulk-revoke"


  // ── FETCH ALL DATA ──────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true)

    const [{ data: profs, error: profErr }, { data: props, error: propErr }, { data: access, error: accErr }] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, email, role, is_active')
        .in('role', ASSIGNABLE_ROLES)
        .order('full_name', { ascending: true }),
      supabase
        .from('properties')
        .select('id, name, city')
        .order('name', { ascending: true }),
      supabase
        .from('property_access')
        .select('id, user_id, property_id, access_level, permission_tier, granted_at, expires_at, notes')
        .order('granted_at', { ascending: false }),
    ])

    if (profErr) console.error('profiles fetch error:', profErr)
    if (propErr) console.error('properties fetch error:', propErr)
    if (accErr)  console.error('access fetch error:', accErr)

    setUsers(
      (profs || []).map((u: any) => ({
        ...u,
        is_active: u.is_active !== false,
      }))
    )
    setProperties(props || [])

    // Group access rows by user_id
    const grouped: Record<string, AccessRow[]> = {}
    for (const row of access || []) {
      const r = row as any
      if (!grouped[r.user_id]) grouped[r.user_id] = []
      grouped[r.user_id].push({
        id: r.id,
        property_id: r.property_id,
        access_level: r.access_level,
        permission_tier: r.permission_tier,
        granted_at: r.granted_at,
        expires_at: r.expires_at,
        notes: r.notes,
      })
    }
    setAccessByUser(grouped)

    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])


  // ── DERIVED ──────────────────────────────────────────────────────────────

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId]
  )

  const selectedUserGrants = useMemo<AccessRow[]>(
    () => (selectedUserId ? (accessByUser[selectedUserId] ?? []) : []),
    [selectedUserId, accessByUser]
  )

  const selectedUserGrantedPropertyIds = useMemo(
    () => new Set(selectedUserGrants.map((g) => g.property_id)),
    [selectedUserGrants]
  )

  const propertiesAvailableToGrant = useMemo(
    () => properties.filter((p) => !selectedUserGrantedPropertyIds.has(p.id)),
    [properties, selectedUserGrantedPropertyIds]
  )

  const filteredAvailableProperties = useMemo(() => {
    const q = propertySearch.trim().toLowerCase()
    if (!q) return propertiesAvailableToGrant
    return propertiesAvailableToGrant.filter((p) =>
      [p.name, p.city ?? ''].some((field) => field.toLowerCase().includes(q))
    )
  }, [propertiesAvailableToGrant, propertySearch])

  const propertyById = useMemo(() => {
    const m = new Map<string, Property>()
    for (const p of properties) m.set(p.id, p)
    return m
  }, [properties])

  // ── ACTIONS ──────────────────────────────────────────────────────────────

  const handleGrantOne = async () => {
    if (!selectedUser || !pendingPropertyId) return
    setBusyAction(`grant-${pendingPropertyId}`)
    const tier: PermissionTier =
      selectedUser.role === 'Property Manager' ? 'full'
      : selectedUser.role === 'Owner' ? 'read'
      : pendingTier
    const result = await grantPropertyAccess({
      userId: selectedUser.id,
      propertyId: pendingPropertyId,
      accessLevel: selectedUser.role,
      permissionTier: tier,
    })
    if (result.success) {
      toast.success(result.message)
      setPendingPropertyId(null)
      setPendingTier('full')
      setPropertyPickerOpen(false)
      setPropertySearch('')
      await fetchAll()
    } else {
      toast.error(result.message)
    }
    setBusyAction(null)
  }

  const handleRevokeOne = async (accessId: string) => {
    if (!confirm('Revoke this property access? The user will lose visibility immediately.')) return
    setBusyAction(`revoke-${accessId}`)
    const result = await revokePropertyAccess(accessId)
    if (result.success) {
      toast.success(result.message)
      await fetchAll()
    } else {
      toast.error(result.message)
    }
    setBusyAction(null)
  }

  const handleGrantAll = async () => {
    if (!selectedUser) return
    if (propertiesAvailableToGrant.length === 0) {
      toast.info('User already has access to every property.')
      return
    }
    if (!confirm(`Grant ${selectedUser.full_name} ${selectedUser.role} access on all ${propertiesAvailableToGrant.length} remaining properties?`)) return
    setBusyAction('bulk-grant')
    const tier: PermissionTier =
      selectedUser.role === 'Property Manager' ? 'full'
      : selectedUser.role === 'Owner' ? 'read'
      : pendingTier
    const result = await bulkGrantPropertyAccess({
      userId: selectedUser.id,
      propertyIds: propertiesAvailableToGrant.map((p) => p.id),
      accessLevel: selectedUser.role,
      permissionTier: tier,
    })
    if (result.success) {
      toast.success(result.message)
      await fetchAll()
    } else {
      toast.error(result.message)
    }
    setBusyAction(null)
  }

  const handleRevokeAll = async () => {
    if (!selectedUser || selectedUserGrants.length === 0) return
    if (!confirm(`Revoke ALL ${selectedUserGrants.length} property grants for ${selectedUser.full_name}? They will see nothing in the app until granted again.`)) return
    setBusyAction('bulk-revoke')
    const result = await bulkRevokePropertyAccess({
      userId: selectedUser.id,
      propertyIds: selectedUserGrants.map((g) => g.property_id),
    })
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
          <Shield size={32} />
        </div>
        <div>
          <h1 className="text-3xl font-black italic uppercase text-slate-900">Property Access</h1>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">
            Assign Property Managers, Accounting, and Owners to specific properties
          </p>
        </div>
      </div>

      {/* INFO BANNER */}
      <div className="flex gap-3 p-4 bg-blue-50 border border-blue-100 rounded-2xl text-sm text-slate-700">
        <AlertCircle size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-bold mb-1">How property access works</p>
          <ul className="list-disc list-inside space-y-0.5 text-slate-600">
            <li><strong>Admins</strong> see every property automatically — they don&apos;t appear here.</li>
            <li><strong>Property Manager</strong> grants give full management on assigned properties only.</li>
            <li><strong>Accounting</strong> grants come in two tiers: Full (post charges/payments) or Read (view only).</li>
            <li><strong>Owner</strong> grants are read-only views per property. For owners managing whole entities, link them via the Owners page.</li>
            <li><strong>Maintenance, Vendors, Tenants</strong> get access through their assigned work orders or leases — not here.</li>
          </ul>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT: USER LIST */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-2">
              <Users size={18} className="text-emerald-600" />
              <h2 className="text-sm font-black italic uppercase tracking-wider">Assignable users</h2>
              {!loading && (
                <span className="ml-auto text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {users.length}
                </span>
              )}
            </div>

            {loading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                No Property Manager, Accounting, or Owner users yet.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {users.map((u) => {
                  const grants = accessByUser[u.id] ?? []
                  const isSelected = selectedUserId === u.id
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(u.id)}
                        className={`w-full text-left px-6 py-4 transition-colors ${
                          isSelected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                        } ${!u.is_active ? 'opacity-40' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-900 truncate">
                              {u.full_name || u.email}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">{u.email}</p>
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${ROLE_BADGE[u.role]}`}>
                              {u.role}
                            </span>
                            <span className="text-[10px] font-black text-slate-400">
                              {grants.length}/{properties.length}
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

        {/* RIGHT: ACCESS DETAIL */}
        <div className="lg:col-span-2">
          {!selectedUser ? (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-12 text-center text-slate-400">
              <Building2 size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-bold">Select a user on the left to manage their property access.</p>
            </div>
          ) : (
            <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">

              {/* PANEL HEADER */}
              <div className="px-6 py-5 border-b border-slate-100">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black italic uppercase">{selectedUser.full_name || selectedUser.email}</h2>
                    <p className="text-[11px] text-slate-500">{selectedUser.email}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider ${ROLE_BADGE[selectedUser.role]}`}>
                    {selectedUser.role}
                  </span>
                </div>
                <div className="mt-3 text-xs font-bold text-slate-500">
                  {selectedUserGrants.length} of {properties.length} properties assigned
                </div>
              </div>

              {/* GRANT LIST */}
              <div className="px-6 py-5 space-y-2">
                {selectedUserGrants.length === 0 ? (
                  <div className="text-sm text-slate-400 italic py-4">
                    No property access yet — grant some below.
                  </div>
                ) : (
                  selectedUserGrants.map((g) => {
                    const prop = propertyById.get(g.property_id)
                    const isBusy = busyAction === `revoke-${g.id}`
                    return (
                      <div
                        key={g.id}
                        className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 rounded-xl"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm text-slate-900 truncate">
                            {prop?.name ?? '(unknown property)'}
                          </p>
                          {prop?.city && (
                            <p className="text-[11px] text-slate-500 truncate">{prop.city}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${ROLE_BADGE[g.access_level]}`}>
                            {g.access_level === 'Accounting' ? `${g.access_level} (${g.permission_tier})` : g.access_level}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleRevokeOne(g.id)}
                            disabled={isBusy}
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
                            title="Revoke access"
                          >
                            {isBusy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* ADD-PROPERTY ROW */}
              <div className="px-6 py-5 border-t border-slate-100 space-y-3">
                {!propertyPickerOpen ? (
                  <button
                    type="button"
                    onClick={() => setPropertyPickerOpen(true)}
                    disabled={propertiesAvailableToGrant.length === 0}
                    className="w-full px-4 py-3 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-30"
                  >
                    <Plus size={16} />
                    {propertiesAvailableToGrant.length === 0
                      ? 'All properties already granted'
                      : `Grant access to a property (${propertiesAvailableToGrant.length} available)`}
                  </button>
                ) : (
                  <div className="space-y-3 p-4 bg-slate-50 rounded-xl">
                    {/* Tier picker (only for Accounting) */}
                    {selectedUser.role === 'Accounting' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Tier:</span>
                        {(['full', 'read'] as PermissionTier[]).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setPendingTier(t)}
                            className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-wider transition-colors ${
                              pendingTier === t
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-white text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Property search */}
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={propertySearch}
                        onChange={(e) => setPropertySearch(e.target.value)}
                        placeholder="Search property by name or city..."
                        className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>

                    {/* Property list (limited height) */}
                    <ul className="max-h-60 overflow-y-auto bg-white rounded-lg border border-slate-200 divide-y divide-slate-100">
                      {filteredAvailableProperties.length === 0 ? (
                        <li className="p-4 text-sm text-slate-400 text-center">No matching properties.</li>
                      ) : (
                        filteredAvailableProperties.map((p) => {
                          const selected = pendingPropertyId === p.id
                          return (
                            <li key={p.id}>
                              <button
                                type="button"
                                onClick={() => setPendingPropertyId(p.id)}
                                className={`w-full text-left px-4 py-2 flex items-center gap-2 ${
                                  selected ? 'bg-emerald-50' : 'hover:bg-slate-50'
                                }`}
                              >
                                {selected && <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />}
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold text-sm text-slate-900 truncate">{p.name}</p>
                                  {p.city && <p className="text-[11px] text-slate-500 truncate">{p.city}</p>}
                                </div>
                              </button>
                            </li>
                          )
                        })
                      )}
                    </ul>

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleGrantOne}
                        disabled={!pendingPropertyId || busyAction !== null}
                        className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
                      >
                        {busyAction?.startsWith('grant-') ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        Grant access
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPropertyPickerOpen(false)
                          setPropertySearch('')
                          setPendingPropertyId(null)
                          setPendingTier('full')
                        }}
                        className="px-4 py-2 bg-white text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-100 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* BULK ACTIONS */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleGrantAll}
                    disabled={propertiesAvailableToGrant.length === 0 || busyAction !== null}
                    className="flex-1 px-4 py-2 bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    {busyAction === 'bulk-grant' ? <Loader2 size={12} className="animate-spin" /> : null}
                    Grant all {propertiesAvailableToGrant.length}
                  </button>
                  <button
                    type="button"
                    onClick={handleRevokeAll}
                    disabled={selectedUserGrants.length === 0 || busyAction !== null}
                    className="flex-1 px-4 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-30 flex items-center justify-center gap-2"
                  >
                    {busyAction === 'bulk-revoke' ? <Loader2 size={12} className="animate-spin" /> : null}
                    Revoke all
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
