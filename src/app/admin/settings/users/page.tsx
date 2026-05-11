'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { createStaffUser } from '@/actions/create-user'
import { disableStaffUser, deleteStaffUser, resetUserPassword, updateUserRole } from '@/actions/manage-user'
import {
  UserPlus, Shield, Loader2, CheckCircle2,
  Users, Trash2, ShieldOff, ShieldCheck, Ban, Home, KeyRound, Copy, X, Search, ChevronDown, Check
} from 'lucide-react'

// Define the shape of our User data
type UserProfile = {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
}

// Lease option for tenant assignment
type LeaseOption = {
  id: string
  tenant_first: string
  tenant_last: string
  unit_name: string
  property_name: string
  rent_amount: number
}

export default function UserSettingsPage() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // State for the list of users
  const [users, setUsers] = useState<UserProfile[]>([])
  const [fetching, setFetching] = useState(true)

  // Track which user action is in progress
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Current user ID (to prevent self-actions)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Tenant creation: role selection + available leases
  const [selectedRole, setSelectedRole] = useState('Property Manager')
  const [availableLeases, setAvailableLeases] = useState<LeaseOption[]>([])
  const [loadingLeases, setLoadingLeases] = useState(false)

  // Lease search combobox state
  const [leaseSearch, setLeaseSearch] = useState('')
  const [leaseDropdownOpen, setLeaseDropdownOpen] = useState(false)
  const [selectedLease, setSelectedLease] = useState<LeaseOption | null>(null)

  // 1. FETCH USERS + CURRENT USER
  const fetchUsers = useCallback(async () => {
    setFetching(true)

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (user) setCurrentUserId(user.id)

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) {
      setUsers(data.map((u: any) => ({
        ...u,
        is_active: u.is_active !== false // default true if null
      })))
    } else if (error) {
      console.error('Error fetching users:', error)
    }
    setFetching(false)
  }, [])

  // FETCH AVAILABLE LEASES (Active leases without a user_id linked)
  const fetchAvailableLeases = useCallback(async () => {
    setLoadingLeases(true)
    const { data, error } = await supabase
      .from('leases')
      .select(`
        id, rent_amount,
        tenants ( first_name, last_name ),
        units ( name, properties ( name ) )
      `)
      .eq('status', 'Active')
      .is('user_id', null)
      .order('id')

    if (data) {
      setAvailableLeases(data.map((l: any) => ({
        id: l.id,
        tenant_first: l.tenants?.first_name || '',
        tenant_last: l.tenants?.last_name || '',
        unit_name: l.units?.name || 'N/A',
        property_name: l.units?.properties?.name || 'N/A',
        rent_amount: l.rent_amount || 0,
      })))
    }
    if (error) console.error('Error fetching leases:', error)
    setLoadingLeases(false)
  }, [])

  // 2. LOAD DATA ON PAGE MOUNT
  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Load available leases when Tenant role is selected
  useEffect(() => {
    if (selectedRole === 'Tenant') {
      fetchAvailableLeases()
    }
  }, [selectedRole, fetchAvailableLeases])

  // 3. HANDLE FORM SUBMIT (Create User)
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    const formData = new FormData(e.currentTarget)
    const result = await createStaffUser(formData)

    setMessage(result.message)
    setLoading(false)

    if (result.success) {
      (e.target as HTMLFormElement).reset()
      setSelectedRole('Property Manager')
      setSelectedLease(null)
      setLeaseSearch('')
      setLeaseDropdownOpen(false)
      fetchUsers()
      if (selectedRole === 'Tenant') fetchAvailableLeases()
    }
  }

  // 4. HANDLE DISABLE/ENABLE
  const handleToggleDisable = async (user: UserProfile) => {
    const action = user.is_active ? 'disable' : 're-enable'
    if (!confirm(`Are you sure you want to ${action} ${user.full_name}? ${user.is_active ? 'They will be immediately locked out.' : 'They will regain access.'}`)) return

    setActionInProgress(user.id)
    const result = await disableStaffUser(user.id)

    if (result.success) {
      toast.success(result.message)
      fetchUsers()
    } else {
      toast.error(result.message)
    }
    setActionInProgress(null)
  }

  // 5. HANDLE DELETE
  const handleDelete = async (user: UserProfile) => {
    if (!window.confirm(`PERMANENTLY DELETE ${user.full_name}?\n\nThis removes their account, profile, and all access. This cannot be undone.`)) return

    setActionInProgress(user.id)
    try {
      const result = await deleteStaffUser(user.id)
      if (result.success) {
        toast.success(result.message)
        fetchUsers()
      } else {
        toast.error(result.message || 'Delete failed')
      }
    } catch (err: any) {
      toast.error('Delete failed: ' + (err.message || 'Unknown error'))
    }
    setActionInProgress(null)
  }

  // 6. HANDLE PASSWORD RESET
  const [resetModal, setResetModal] = useState<{ userName: string; tempPassword: string } | null>(null)

  const handleResetPassword = async (user: UserProfile) => {
    if (!window.confirm(`Reset password for ${user.full_name}?\n\nThey will be signed out immediately and must log in with the new temporary password.`)) return

    setActionInProgress(user.id)
    try {
      const result = await resetUserPassword(user.id)
      if (result.success && result.tempPassword) {
        setResetModal({ userName: user.full_name, tempPassword: result.tempPassword })
        toast.success(result.message)
      } else {
        toast.error(result.message || 'Password reset failed')
      }
    } catch (err: any) {
      toast.error('Reset failed: ' + (err.message || 'Unknown error'))
    }
    setActionInProgress(null)
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-12 animate-in fade-in duration-500">

      {/* HEADER */}
      <div className="flex items-center gap-4">
        <div className="p-4 bg-emerald-100 text-emerald-700 rounded-2xl">
          <Shield size={32} />
        </div>
        <div>
          <h1 className="text-3xl font-black italic uppercase text-slate-900">System Settings</h1>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest">User Access &amp; Permissions</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* LEFT COLUMN: CREATE USER FORM */}
        <div className="lg:col-span-1">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm sticky top-6">
            <h3 className="text-xl font-black italic uppercase mb-6 flex items-center gap-2">
              <UserPlus size={20} className="text-emerald-600" />
              Add New Staff
            </h3>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 ml-2">Full Name</label>
                <input name="fullName" required type="text" className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20" placeholder="John Doe" />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 ml-2">Role Assignment</label>
                <select
                  name="role"
                  required
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
                >
                  <option value="Property Manager">Property Manager</option>
                  <option value="Accounting">Accounting</option>
                  <option value="Vendor">Vendor</option>
                  <option value="Admin">System Admin</option>
                  <option value="Tenant">Tenant</option>
                  <option value="Owner">Owner</option>
                </select>
              </div>

              {/* LEASE PICKER — Searchable combobox, only shown when creating a Tenant */}
              {selectedRole === 'Tenant' && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 ml-2">
                    <Home size={10} className="inline mr-1" />
                    Link to Lease
                  </label>
                  {loadingLeases ? (
                    <div className="flex items-center gap-2 px-5 py-3 text-slate-400 text-xs">
                      <Loader2 size={14} className="animate-spin" /> Loading leases...
                    </div>
                  ) : availableLeases.length === 0 ? (
                    <div className="px-5 py-3 bg-orange-50 border border-orange-100 rounded-xl text-xs font-bold text-orange-600">
                      No unlinked active leases found. Create a lease first.
                    </div>
                  ) : (
                    <div className="relative">
                      {/* Hidden input to pass the selected lease ID to the form */}
                      <input type="hidden" name="leaseId" value={selectedLease?.id || ''} />

                      {/* Selected lease display / search trigger */}
                      {selectedLease && !leaseDropdownOpen ? (
                        <button
                          type="button"
                          onClick={() => { setLeaseDropdownOpen(true); setLeaseSearch('') }}
                          className="w-full text-left px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 group hover:border-emerald-400 transition-colors"
                        >
                          <Check size={16} className="text-emerald-600 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-slate-900 truncate">
                              {selectedLease.tenant_first} {selectedLease.tenant_last}
                            </p>
                            <p className="text-[10px] text-slate-500 truncate">
                              {selectedLease.property_name} &bull; Unit {selectedLease.unit_name} &bull; ${selectedLease.rent_amount}/mo
                            </p>
                          </div>
                          <X
                            size={16}
                            className="text-slate-300 hover:text-red-500 shrink-0 transition-colors"
                            onClick={(e) => { e.stopPropagation(); setSelectedLease(null); setLeaseSearch('') }}
                          />
                        </button>
                      ) : (
                        <div className="relative">
                          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={leaseSearch}
                            onChange={(e) => { setLeaseSearch(e.target.value); setLeaseDropdownOpen(true) }}
                            onFocus={() => setLeaseDropdownOpen(true)}
                            className="w-full pl-11 pr-10 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300"
                            placeholder="Search by name, property, or unit..."
                            autoComplete="off"
                          />
                          <ChevronDown
                            size={16}
                            className={`absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-transform ${leaseDropdownOpen ? 'rotate-180' : ''}`}
                          />
                        </div>
                      )}

                      {/* Dropdown results */}
                      {leaseDropdownOpen && !selectedLease && (
                        <>
                          {/* Click-outside overlay */}
                          <div className="fixed inset-0 z-10" onClick={() => setLeaseDropdownOpen(false)} />

                          <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto">
                            {(() => {
                              const query = leaseSearch.toLowerCase().trim()
                              const filtered = availableLeases.filter(l => {
                                if (!query) return true
                                const searchStr = `${l.tenant_first} ${l.tenant_last} ${l.property_name} ${l.unit_name}`.toLowerCase()
                                return query.split(/\s+/).every(word => searchStr.includes(word))
                              })

                              if (filtered.length === 0) {
                                return (
                                  <div className="px-4 py-6 text-center">
                                    <p className="text-sm text-slate-400 font-bold">No leases match &ldquo;{leaseSearch}&rdquo;</p>
                                    <p className="text-[10px] text-slate-300 mt-1">Try a different name, property, or unit</p>
                                  </div>
                                )
                              }

                              return filtered.map(l => (
                                <button
                                  key={l.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedLease(l)
                                    setLeaseDropdownOpen(false)
                                    setLeaseSearch('')
                                  }}
                                  className="w-full text-left px-4 py-3 hover:bg-emerald-50 transition-colors flex items-center gap-3 border-b border-slate-50 last:border-0"
                                >
                                  <div className="w-9 h-9 bg-slate-100 text-slate-500 rounded-lg flex items-center justify-center shrink-0">
                                    <Home size={16} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm text-slate-900 truncate">
                                      {l.tenant_first} {l.tenant_last}
                                    </p>
                                    <p className="text-[10px] text-slate-500 truncate">
                                      {l.property_name} &bull; Unit {l.unit_name} &bull; ${l.rent_amount}/mo
                                    </p>
                                  </div>
                                </button>
                              ))
                            })()}
                          </div>
                        </>
                      )}

                      {/* Validation: require a selected lease */}
                      {!selectedLease && (
                        <input
                          tabIndex={-1}
                          autoComplete="off"
                          style={{ opacity: 0, height: 0, position: 'absolute', pointerEvents: 'none' }}
                          value={selectedLease ? 'valid' : ''}
                          onChange={() => {}}
                          required
                        />
                      )}
                    </div>
                  )}
                  <p className="text-[9px] text-slate-400 mt-1.5 ml-2">
                    This links the tenant login to their lease so they can see their property, unit &amp; payments.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 ml-2">Email Address</label>
                <input name="email" required type="email" className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20" placeholder="staff@rylexa.com" />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 ml-2">Temporary Password</label>
                <input name="password" required type="password" className="w-full px-5 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20" placeholder="••••••••" />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full px-8 py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                {loading ? 'Creating...' : 'Create Account'}
              </button>

              {message && (
                <div className={`p-4 rounded-xl text-xs font-bold text-center ${message.includes('Success') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  {message}
                </div>
              )}
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: USER LIST */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-xl font-black italic uppercase flex items-center gap-2">
                <Users size={20} className="text-blue-600" />
                Authorized Users
              </h3>
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                  {users.filter(u => u.is_active).length} Active
                </span>
                {users.filter(u => !u.is_active).length > 0 && (
                  <span className="px-3 py-1 bg-red-50 text-red-500 rounded-full text-[10px] font-black uppercase tracking-widest">
                    {users.filter(u => !u.is_active).length} Disabled
                  </span>
                )}
              </div>
            </div>

            {fetching ? (
              <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
                <Loader2 className="animate-spin" />
                <span className="text-xs font-bold uppercase tracking-widest">Loading Profiles...</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-8 py-4">Name / Email</th>
                      <th className="px-8 py-4">Role</th>
                      <th className="px-8 py-4">Status</th>
                      <th className="px-8 py-4">Joined</th>
                      <th className="px-8 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {users.map((user) => {
                      const isSelf = user.id === currentUserId
                      const isProcessing = actionInProgress === user.id

                      return (
                        <tr
                          key={user.id}
                          className={`transition-colors ${
                            !user.is_active
                              ? 'bg-red-50/30 opacity-60'
                              : 'hover:bg-slate-50/50'
                          }`}
                        >
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                              <div>
                                <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                                  {user.full_name}
                                  {isSelf && (
                                    <span className="px-2 py-0.5 bg-blue-50 text-blue-500 rounded text-[8px] font-black uppercase">You</span>
                                  )}
                                </div>
                                <div className="text-xs text-slate-400 font-medium">{user.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            {isSelf ? (
                              <span className={`inline-block px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider ${
                                user.role === 'Admin' ? 'bg-purple-50 text-purple-600' :
                                user.role === 'Accounting' ? 'bg-amber-50 text-amber-600' :
                                user.role === 'Maintenance' ? 'bg-orange-50 text-orange-600' :
                                user.role === 'Vendor' ? 'bg-slate-100 text-slate-600' :
                                user.role === 'Tenant' ? 'bg-green-50 text-green-600' :
                                user.role === 'Owner' ? 'bg-indigo-50 text-indigo-600' :
                                'bg-blue-50 text-blue-600'
                              }`}>
                                {user.role}
                              </span>
                            ) : (
                              <select
                                value={user.role}
                                disabled={isProcessing}
                                onChange={async (e) => {
                                  const newRole = e.target.value
                                  if (newRole === user.role) return
                                  if (!confirm(`Change ${user.full_name}'s role from ${user.role} to ${newRole}?`)) {
                                    e.target.value = user.role
                                    return
                                  }
                                  setActionInProgress(user.id)
                                  const result = await updateUserRole(user.id, newRole)
                                  if (result.success) {
                                    toast.success(result.message)
                                    fetchUsers()
                                  } else {
                                    toast.error(result.message)
                                    e.target.value = user.role
                                  }
                                  setActionInProgress(null)
                                }}
                                className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider border-0 cursor-pointer outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-30 ${
                                  user.role === 'Admin' ? 'bg-purple-50 text-purple-600' :
                                  user.role === 'Accounting' ? 'bg-amber-50 text-amber-600' :
                                  user.role === 'Maintenance' ? 'bg-orange-50 text-orange-600' :
                                  user.role === 'Vendor' ? 'bg-slate-100 text-slate-600' :
                                  user.role === 'Tenant' ? 'bg-green-50 text-green-600' :
                                  user.role === 'Owner' ? 'bg-indigo-50 text-indigo-600' :
                                  'bg-blue-50 text-blue-600'
                                }`}
                              >
                                <option value="Admin">Admin</option>
                                <option value="Property Manager">Property Manager</option>
                                <option value="Accounting">Accounting</option>
                                <option value="Maintenance">Maintenance</option>
                                <option value="Vendor">Vendor</option>
                                <option value="Tenant">Tenant</option>
                                <option value="Owner">Owner</option>
                              </select>
                            )}
                          </td>
                          <td className="px-8 py-5">
                            {user.is_active ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-md text-[9px] font-black uppercase tracking-wider">
                                <ShieldCheck size={12} />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-500 rounded-md text-[9px] font-black uppercase tracking-wider">
                                <Ban size={12} />
                                Disabled
                              </span>
                            )}
                          </td>
                          <td className="px-8 py-5">
                            <div className="text-xs font-bold text-slate-500">
                              {new Date(user.created_at).toLocaleDateString()}
                            </div>
                          </td>
                          <td className="px-8 py-5 text-right">
                            {isSelf ? (
                              <span className="text-[9px] text-slate-300 font-bold uppercase tracking-widest">—</span>
                            ) : (
                              <div className="flex gap-1 justify-end">
                                {/* Disable / Enable Toggle */}
                                <button
                                  onClick={() => handleToggleDisable(user)}
                                  disabled={isProcessing}
                                  className={`p-2 rounded-lg transition-colors ${
                                    user.is_active
                                      ? 'text-slate-400 hover:text-orange-500 hover:bg-orange-50'
                                      : 'text-emerald-400 hover:text-emerald-600 hover:bg-emerald-50'
                                  } disabled:opacity-30`}
                                  title={user.is_active ? 'Disable Account' : 'Re-enable Account'}
                                >
                                  {isProcessing ? (
                                    <Loader2 size={16} className="animate-spin" />
                                  ) : user.is_active ? (
                                    <ShieldOff size={16} />
                                  ) : (
                                    <ShieldCheck size={16} />
                                  )}
                                </button>

                                {/* Reset Password */}
                                <button
                                  onClick={() => handleResetPassword(user)}
                                  disabled={isProcessing}
                                  className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-30"
                                  title="Reset Password"
                                >
                                  {isProcessing ? (
                                    <Loader2 size={16} className="animate-spin" />
                                  ) : (
                                    <KeyRound size={16} />
                                  )}
                                </button>

                                {/* Delete */}
                                <button
                                  onClick={() => handleDelete(user)}
                                  disabled={isProcessing}
                                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-30"
                                  title="Permanently Delete"
                                >
                                  {isProcessing ? (
                                    <Loader2 size={16} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={16} />
                                  )}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-8 py-12 text-center text-slate-400 font-bold text-xs uppercase tracking-widest">
                          No staff members found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* PASSWORD RESET MODAL — shows the temporary password */}
      {resetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md mx-4 animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-50 rounded-xl">
                  <KeyRound size={20} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="font-black italic uppercase text-slate-900">Password Reset</h3>
                  <p className="text-xs text-slate-400 font-bold">{resetModal.userName}</p>
                </div>
              </div>
              <button
                onClick={() => setResetModal(null)}
                className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
              <label className="block text-[9px] font-black uppercase text-slate-400 tracking-widest mb-2">
                Temporary Password
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white px-4 py-3 rounded-lg border border-slate-100 font-mono font-bold text-sm text-slate-900 select-all">
                  {resetModal.tempPassword}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(resetModal.tempPassword)
                    toast.success('Password copied to clipboard')
                  }}
                  className="p-3 bg-slate-900 text-white rounded-xl hover:bg-emerald-600 transition-colors"
                  title="Copy to clipboard"
                >
                  <Copy size={16} />
                </button>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-6">
              <p className="text-[10px] font-bold text-amber-700 leading-relaxed">
                Share this password securely with the user. They have been signed out and must log in with this new password. This password will not be shown again.
              </p>
            </div>

            <button
              onClick={() => setResetModal(null)}
              className="w-full px-6 py-3 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
