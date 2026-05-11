'use client'

import { useState } from 'react'
import {
  FolderOpen, Plus, Search, Filter, Download, Trash2,
  FileText, Image, File, Share2, Loader2, AlertCircle,
  Eye, EyeOff
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useDocuments,
  DOCUMENT_TYPE_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  formatFileSize,
  getDocTypeColor,
  type Document,
  type DocumentFilters,
} from '@/hooks/useDocuments'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import UploadDocumentModal from '@/components/UploadDocumentModal'

const TYPE_COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
}

const MIME_ICON: Record<string, typeof FileText> = {
  'application/pdf': FileText,
  'image/jpeg': Image,
  'image/png': Image,
  'image/webp': Image,
  'image/heic': Image,
}

export default function DocumentLibraryPage() {
  const { isEnabled } = useFeatureFlags()
  const documentManagementEnabled = isEnabled('document_management')

  // ── Filters ──
  const [filterType, setFilterType] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  const filters: DocumentFilters = {
    document_type: filterType || undefined,
    entity_type: filterEntity || undefined,
    search: searchDebounced || undefined,
  }

  const {
    documents, loading, upload, uploading,
    deleteDoc, deleting, updateSharing, downloadDocument, refresh,
  } = useDocuments(filters)

  // ── Modals / local state ──
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // ── Search debounce ──
  const handleSearch = (value: string) => {
    setSearch(value)
    // Simple debounce via timeout
    clearTimeout((window as any).__docSearchTimer)
    ;(window as any).__docSearchTimer = setTimeout(() => {
      setSearchDebounced(value)
    }, 400)
  }

  // ── Delete handler ──
  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.title}"? This cannot be undone.`)) return
    setDeletingId(doc.id)
    try {
      await deleteDoc(doc)
    } finally {
      setDeletingId(null)
    }
  }

  // ── Download handler ──
  const handleDownload = async (doc: Document) => {
    setDownloadingId(doc.id)
    await downloadDocument(doc)
    setDownloadingId(null)
  }

  // ── Toggle share ──
  const handleToggleShare = async (doc: Document) => {
    const newShared = !doc.is_shared
    await updateSharing({
      id: doc.id,
      is_shared: newShared,
      shared_with: newShared ? doc.shared_with.length > 0 ? doc.shared_with : ['Tenant', 'Owner'] : [],
    })
  }

  // ── Feature flag gate ──
  if (!documentManagementEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <FolderOpen size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-black text-slate-900 italic">Document Management</h2>
          <p className="text-slate-500 text-sm mt-2">
            This feature is not enabled. Enable the <strong>document_management</strong> flag in Settings to activate.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Document <span className="text-blue-600">Library</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            {documents.length} Document{documents.length !== 1 ? 's' : ''} &bull; Centralized File Management
          </p>
        </div>
        <button
          onClick={() => setIsUploadOpen(true)}
          className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-blue-600 transition-all flex items-center gap-2 shadow-lg hover:-translate-y-1"
        >
          <Plus size={16} /> Upload Document
        </button>
      </div>

      {/* CONTROLS BAR */}
      <div className="max-w-7xl mx-auto bg-white p-2 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-2 mb-8">

        {/* Type Filter */}
        <div className="relative min-w-[200px]">
          <Filter className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer appearance-none"
          >
            <option value="">All Types</option>
            {DOCUMENT_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Entity Filter */}
        <div className="relative min-w-[200px]">
          <Filter className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer appearance-none"
          >
            <option value="">All Entities</option>
            {ENTITY_TYPE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400"
          />
        </div>
      </div>

      {/* DOCUMENT TABLE */}
      <div className="max-w-7xl mx-auto">
        {loading ? (
          <div className="py-20 text-center">
            <Loader2 className="animate-spin mx-auto text-blue-600 mb-4" size={32} />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading Documents...</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="py-20 text-center">
            <FolderOpen size={48} className="text-slate-300 mx-auto mb-4" />
            <p className="text-slate-400 font-bold text-sm">
              {search || filterType || filterEntity
                ? 'No documents match your filters'
                : 'No documents yet'}
            </p>
            <p className="text-slate-400 text-xs mt-1">
              {!search && !filterType && !filterEntity && 'Upload your first document to get started.'}
            </p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100 text-[9px] font-black uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="px-6 py-4">Document</th>
                  <th className="px-6 py-4">Type</th>
                  <th className="px-6 py-4">Linked To</th>
                  <th className="px-6 py-4">Uploaded By</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Size</th>
                  <th className="px-6 py-4 text-center">Shared</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {documents.map((doc) => {
                  const color = getDocTypeColor(doc.document_type)
                  const colorClasses = TYPE_COLOR_MAP[color] || TYPE_COLOR_MAP.slate
                  const DocIcon = MIME_ICON[doc.mime_type] || File
                  const typeLabel = DOCUMENT_TYPE_OPTIONS.find(t => t.value === doc.document_type)?.label || doc.document_type
                  const entityLabel = ENTITY_TYPE_OPTIONS.find(e => e.value === doc.entity_type)?.label || doc.entity_type

                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/50 transition-colors group">
                      {/* Document */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                            <DocIcon size={18} className="text-slate-400 group-hover:text-blue-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 truncate max-w-[220px]">{doc.title}</p>
                            <p className="text-[10px] text-slate-400 font-bold truncate max-w-[220px]">{doc.file_name}</p>
                          </div>
                        </div>
                      </td>

                      {/* Type Badge */}
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${colorClasses}`}>
                          {typeLabel}
                        </span>
                      </td>

                      {/* Entity */}
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-slate-600">{entityLabel}</span>
                      </td>

                      {/* Uploader */}
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-slate-500">{doc.uploader_name}</span>
                      </td>

                      {/* Date */}
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-slate-400">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </span>
                      </td>

                      {/* Size */}
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-slate-400">{formatFileSize(doc.file_size)}</span>
                      </td>

                      {/* Shared */}
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => handleToggleShare(doc)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            doc.is_shared
                              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                              : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
                          }`}
                          title={doc.is_shared ? `Shared with: ${doc.shared_with.join(', ')}` : 'Not shared'}
                        >
                          {doc.is_shared ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleDownload(doc)}
                            disabled={downloadingId === doc.id}
                            className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Download"
                          >
                            {downloadingId === doc.id
                              ? <Loader2 size={16} className="animate-spin" />
                              : <Download size={16} />
                            }
                          </button>
                          <button
                            onClick={() => handleDelete(doc)}
                            disabled={deletingId === doc.id}
                            className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            {deletingId === doc.id
                              ? <Loader2 size={16} className="animate-spin" />
                              : <Trash2 size={16} />
                            }
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* UPLOAD MODAL */}
      <UploadDocumentModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploaded={refresh}
        upload={upload}
        uploading={uploading}
      />
    </div>
  )
}
