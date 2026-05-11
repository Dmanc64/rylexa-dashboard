'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload, FileText, Image, File, X, Loader2,
  Building2, Home, Users, Wrench, FileSignature,
  Share2, Eye
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import {
  DOCUMENT_TYPE_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  type UploadPayload,
  formatFileSize,
} from '@/hooks/useDocuments'
import { DOCUMENT_ALLOWED_TYPES, DOCUMENT_MAX_FILE_SIZE } from '@/lib/upload-utils'

interface UploadDocumentModalProps {
  isOpen: boolean
  onClose: () => void
  onUploaded: () => void
  upload: (payload: UploadPayload) => Promise<void>
  uploading: boolean
  /** Pre-fill entity link (e.g. from property detail page) */
  defaultEntityType?: string
  defaultEntityId?: string
}

type EntityOption = { id: string; label: string }

const MIME_ICON: Record<string, typeof FileText> = {
  'application/pdf': FileText,
  'image/jpeg': Image,
  'image/png': Image,
  'image/webp': Image,
  'image/heic': Image,
}

const ENTITY_ICON: Record<string, typeof Building2> = {
  property: Building2,
  unit: Home,
  lease: FileSignature,
  tenant: Users,
  work_order: Wrench,
}

export default function UploadDocumentModal({
  isOpen,
  onClose,
  onUploaded,
  upload,
  uploading,
  defaultEntityType,
  defaultEntityId,
}: UploadDocumentModalProps) {
  // ── File state ──
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Form state ──
  const [title, setTitle] = useState('')
  const [documentType, setDocumentType] = useState('other')
  const [notes, setNotes] = useState('')

  // ── Entity linking ──
  const [entityType, setEntityType] = useState(defaultEntityType || 'property')
  const [entityId, setEntityId] = useState(defaultEntityId || '')
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([])
  const [entityLoading, setEntityLoading] = useState(false)

  // ── Cascading: property → unit ──
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [properties, setProperties] = useState<EntityOption[]>([])

  // ── Sharing ──
  const [isShared, setIsShared] = useState(false)
  const [sharedWith, setSharedWith] = useState<string[]>([])

  // ── Reset form when modal opens/closes ──
  useEffect(() => {
    if (isOpen) {
      setFile(null)
      setTitle('')
      setDocumentType('other')
      setNotes('')
      setEntityType(defaultEntityType || 'property')
      setEntityId(defaultEntityId || '')
      setIsShared(false)
      setSharedWith([])
      setSelectedPropertyId('')
    }
  }, [isOpen, defaultEntityType, defaultEntityId])

  // ── Fetch entity options when entityType changes ──
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false

    async function fetchOptions() {
      setEntityLoading(true)
      setEntityOptions([])
      setEntityId(defaultEntityType === entityType && defaultEntityId ? defaultEntityId : '')

      try {
        switch (entityType) {
          case 'property': {
            const { data } = await supabase
              .from('properties')
              .select('id, name')
              .order('name')
            if (!cancelled && data) {
              setEntityOptions(data.map(p => ({ id: p.id, label: p.name })))
              setProperties(data.map(p => ({ id: p.id, label: p.name })))
            }
            break
          }
          case 'unit': {
            // First load properties for cascading
            const { data: props } = await supabase
              .from('properties')
              .select('id, name')
              .order('name')
            if (!cancelled && props) {
              setProperties(props.map(p => ({ id: p.id, label: p.name })))
            }
            // Units loaded when property is selected
            break
          }
          case 'lease': {
            const { data } = await supabase
              .from('lease_details_view')
              .select('lease_id, tenant_name, unit_name, property_name')
              .eq('status', 'Active')
              .order('tenant_name')
            if (!cancelled && data) {
              setEntityOptions(data.map((l: any) => ({
                id: l.lease_id,
                label: `${l.tenant_name} — ${l.unit_name} (${l.property_name})`,
              })))
            }
            break
          }
          case 'tenant': {
            const { data } = await supabase
              .from('tenants')
              .select('id, full_name')
              .order('full_name')
            if (!cancelled && data) {
              setEntityOptions(data.map(t => ({ id: t.id, label: t.full_name || 'Unknown' })))
            }
            break
          }
          case 'work_order': {
            const { data } = await supabase
              .from('work_orders')
              .select('id, title')
              .order('created_at', { ascending: false })
              .limit(100)
            if (!cancelled && data) {
              setEntityOptions(data.map(wo => ({ id: wo.id, label: wo.title })))
            }
            break
          }
        }
      } catch {
        // Silently fail — user can retry
      } finally {
        if (!cancelled) setEntityLoading(false)
      }
    }

    fetchOptions()
    return () => { cancelled = true }
  }, [isOpen, entityType, defaultEntityType, defaultEntityId])

  // ── Fetch units when property changes (for unit entity type) ──
  useEffect(() => {
    if (entityType !== 'unit' || !selectedPropertyId) {
      if (entityType === 'unit') setEntityOptions([])
      return
    }
    let cancelled = false

    async function fetchUnits() {
      const { data } = await supabase
        .from('units')
        .select('id, name')
        .eq('property_id', selectedPropertyId)
        .order('name')

      if (!cancelled && data) {
        setEntityOptions(data.map(u => ({ id: u.id, label: u.name })))
      }
    }
    fetchUnits()
    return () => { cancelled = true }
  }, [entityType, selectedPropertyId])

  // ── Drag & Drop handlers ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) validateAndSetFile(dropped)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) validateAndSetFile(selected)
  }

  const validateAndSetFile = (f: File) => {
    if (!DOCUMENT_ALLOWED_TYPES.includes(f.type)) {
      toast.error('Unsupported file type. Allowed: PDF, images, Word, Excel, text.')
      return
    }
    if (f.size > DOCUMENT_MAX_FILE_SIZE) {
      toast.error('File too large (max 25MB)')
      return
    }
    setFile(f)
    // Auto-fill title from filename if empty
    if (!title) {
      const name = f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
      setTitle(name.charAt(0).toUpperCase() + name.slice(1))
    }
  }

  const handleShareToggle = (role: string) => {
    setSharedWith(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    )
  }

  // ── Submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { toast.error('Please select a file'); return }
    if (!title.trim()) { toast.error('Please enter a title'); return }
    if (!entityId) { toast.error('Please select an entity to link this document to'); return }

    try {
      await upload({
        file,
        title: title.trim(),
        document_type: documentType,
        entity_type: entityType,
        entity_id: entityId,
        notes: notes.trim() || undefined,
        is_shared: isShared && sharedWith.length > 0,
        shared_with: isShared ? sharedWith : [],
      })
      onUploaded()
      onClose()
    } catch {
      // Error already handled by hook toast
    }
  }

  const FileIcon = file ? (MIME_ICON[file.type] || File) : File
  const EntityIcon = ENTITY_ICON[entityType] || File

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Upload Document"
      subtitle="Add a file to the document library"
      size="max-w-2xl"
      headerBg="bg-blue-50"
      headerTextColor="text-blue-900"
      closeBtnColor="text-blue-400"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-6">

        {/* ── DROP ZONE ── */}
        {!file ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
              ${isDragging
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50/50'
              }
            `}
          >
            <Upload size={32} className={`mx-auto mb-3 ${isDragging ? 'text-blue-500' : 'text-slate-300'}`} />
            <p className="text-sm font-bold text-slate-700">
              Drop file here or <span className="text-blue-600 underline">browse</span>
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2">
              PDF, Images, Word, Excel, Text &bull; Max 25MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        ) : (
          /* ── FILE PREVIEW ── */
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <FileIcon size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{file.name}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase">
                {formatFileSize(file.size)} &bull; {file.type.split('/').pop()?.toUpperCase()}
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ── TITLE + TYPE ── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              placeholder="e.g. Insurance Certificate 2026"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Document Type
            </label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white appearance-none cursor-pointer"
            >
              {DOCUMENT_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── ENTITY LINKING ── */}
        <div className="space-y-3">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Link To <span className="text-red-500">*</span>
          </label>

          <div className="flex gap-2 flex-wrap">
            {ENTITY_TYPE_OPTIONS.map(opt => {
              const Icon = ENTITY_ICON[opt.value] || File
              const isActive = entityType === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setEntityType(opt.value)
                    setEntityId('')
                    setSelectedPropertyId('')
                  }}
                  className={`
                    px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all border
                    ${isActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow-lg'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                    }
                  `}
                >
                  <Icon size={14} />
                  {opt.label}
                </button>
              )
            })}
          </div>

          {/* Cascading: property selector for units */}
          {entityType === 'unit' && (
            <select
              value={selectedPropertyId}
              onChange={(e) => { setSelectedPropertyId(e.target.value); setEntityId('') }}
              className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none cursor-pointer"
            >
              <option value="">Select property first...</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          )}

          {/* Entity selector */}
          <div className="relative">
            <EntityIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              disabled={entityLoading || (entityType === 'unit' && !selectedPropertyId)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">
                {entityLoading
                  ? 'Loading...'
                  : entityType === 'unit' && !selectedPropertyId
                    ? 'Select property first...'
                    : `Select ${ENTITY_TYPE_OPTIONS.find(e => e.value === entityType)?.label || 'entity'}...`
                }
              </option>
              {entityOptions.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
            {entityLoading && (
              <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />
            )}
          </div>
        </div>

        {/* ── NOTES ── */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
            placeholder="Optional notes about this document..."
          />
        </div>

        {/* ── SHARING ── */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isShared}
              onChange={(e) => {
                setIsShared(e.target.checked)
                if (!e.target.checked) setSharedWith([])
              }}
              className="w-4 h-4 accent-blue-600"
            />
            <div className="flex items-center gap-2">
              <Share2 size={14} className="text-blue-500" />
              <span className="text-xs font-bold text-slate-700">Share with portal users</span>
            </div>
          </label>

          {isShared && (
            <div className="flex gap-3 pl-7">
              {['Tenant', 'Owner', 'Vendor'].map(role => (
                <label
                  key={role}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all
                    ${sharedWith.includes(role)
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-blue-200'
                    }
                  `}
                >
                  <input
                    type="checkbox"
                    checked={sharedWith.includes(role)}
                    onChange={() => handleShareToggle(role)}
                    className="w-3.5 h-3.5 accent-blue-600"
                  />
                  <Eye size={12} />
                  {role}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ── SUBMIT ── */}
        <button
          type="submit"
          disabled={uploading || !file || !title.trim() || !entityId}
          className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload size={16} />
              Upload Document
            </>
          )}
        </button>
      </form>
    </AccessibleModal>
  )
}
