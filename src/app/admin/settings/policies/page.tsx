'use client'

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import {
  Shield, Plus, Pencil, Trash2, ToggleLeft, ToggleRight,
  Loader2, ArrowLeft, Building2, ChevronDown, Save, X
} from 'lucide-react'
import Link from 'next/link'
import {
  usePropertyPolicies,
  POLICY_CATEGORIES,
  type PolicyCategory,
  type PropertyPolicy
} from '@/hooks/usePropertyPolicies'

type Property = { id: string; name: string; address: string }

export default function PoliciesPage() {
  const [properties, setProperties] = useState<Property[]>([])
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)
  const [propertiesLoading, setPropertiesLoading] = useState(true)

  const { policies, loading, createPolicy, updatePolicy, deletePolicy, toggleActive } =
    usePropertyPolicies(selectedPropertyId)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<PropertyPolicy | null>(null)
  const [formData, setFormData] = useState({
    category: 'general_rules' as PolicyCategory,
    title: '',
    content: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetchProperties() {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, address')
        .order('name')
      if (error) console.error('Failed to fetch properties:', error.message)
      setProperties(data || [])
      if (data && data.length > 0 && !selectedPropertyId) {
        setSelectedPropertyId(data[0].id)
      }
      setPropertiesLoading(false)
    }
    fetchProperties()
  }, [])

  const handleOpenCreate = () => {
    setEditingPolicy(null)
    setFormData({ category: 'general_rules', title: '', content: '' })
    setIsFormOpen(true)
  }

  const handleOpenEdit = (policy: PropertyPolicy) => {
    setEditingPolicy(policy)
    setFormData({
      category: policy.category,
      title: policy.title,
      content: policy.content,
    })
    setIsFormOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPropertyId) return
    if (!formData.title.trim() || !formData.content.trim()) {
      toast.error('Title and content are required')
      return
    }

    setSaving(true)
    try {
      if (editingPolicy) {
        await updatePolicy(editingPolicy.id, formData)
        toast.success('Policy updated')
      } else {
        await createPolicy({ ...formData, property_id: selectedPropertyId })
        toast.success('Policy created')
      }
      setIsFormOpen(false)
      setEditingPolicy(null)
    } catch (err: any) {
      toast.error(err.message || 'Failed to save policy')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (policy: PropertyPolicy) => {
    if (!confirm(`Delete "${policy.title}"? This cannot be undone.`)) return
    try {
      await deletePolicy(policy.id)
      toast.success('Policy deleted')
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete policy')
    }
  }

  const handleToggle = async (policy: PropertyPolicy) => {
    try {
      await toggleActive(policy.id, !policy.is_active)
      toast.success(policy.is_active ? 'Policy deactivated' : 'Policy activated')
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle policy')
    }
  }

  const getCategoryLabel = (cat: PolicyCategory) =>
    POLICY_CATEGORIES.find(c => c.value === cat)?.label || cat

  if (propertiesLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-blue-500" size={40} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/admin/settings" className="text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex items-center gap-2">
          <Shield className="text-purple-500" size={24} />
          <h1 className="text-2xl font-bold text-slate-800">Property Policies</h1>
        </div>
        <span className="text-xs text-slate-400 ml-2">Manage rules surfaced by the AI assistant</span>
      </div>

      {/* Property selector */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-slate-600">Property:</span>
        </div>
        <select
          value={selectedPropertyId || ''}
          onChange={(e) => setSelectedPropertyId(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        >
          {properties.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          onClick={handleOpenCreate}
          className="ml-auto flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Policy
        </button>
      </div>

      {/* Policy form (modal-like) */}
      {isFormOpen && (
        <div className="mb-6 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">
              {editingPolicy ? 'Edit Policy' : 'New Policy'}
            </h2>
            <button onClick={() => { setIsFormOpen(false); setEditingPolicy(null) }} className="text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData(f => ({ ...f, category: e.target.value as PolicyCategory }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  {POLICY_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g., Pet Policy"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1">Policy Content</label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData(f => ({ ...f, content: e.target.value }))}
                placeholder="Write the full policy text that the AI assistant will reference when answering tenant questions..."
                rows={6}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-y"
                required
              />
              <p className="text-[10px] text-slate-400 mt-1">This content will be shown to tenants by the AI assistant when they ask about related topics.</p>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setIsFormOpen(false); setEditingPolicy(null) }}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingPolicy ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Policies list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-blue-500" size={24} />
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-20">
          <Shield className="mx-auto text-slate-300 mb-4" size={48} />
          <p className="text-slate-500 font-medium">No policies yet</p>
          <p className="text-slate-400 text-sm mt-1">Add property policies so the AI assistant can answer tenant questions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map(policy => (
            <div
              key={policy.id}
              className={`bg-white rounded-xl border shadow-sm p-5 transition-all ${
                policy.is_active ? 'border-slate-200' : 'border-slate-100 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">
                      {getCategoryLabel(policy.category)}
                    </span>
                    {!policy.is_active && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        Inactive
                      </span>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">{policy.title}</h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{policy.content}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleToggle(policy)}
                    title={policy.is_active ? 'Deactivate' : 'Activate'}
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    {policy.is_active ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} />}
                  </button>
                  <button
                    onClick={() => handleOpenEdit(policy)}
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(policy)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
