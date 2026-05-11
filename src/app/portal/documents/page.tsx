'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  FolderOpen, Download, FileText, Image, File,
  Loader2, AlertCircle, Clock
} from 'lucide-react'
import { toast } from 'sonner'

type SharedDocument = {
  id: string
  title: string
  document_type: string
  entity_type: string
  file_path: string
  file_name: string
  file_size: number
  mime_type: string
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  lease_agreement: 'Lease Agreement',
  notice: 'Notice',
  inspection: 'Inspection',
  receipt: 'Receipt',
  photo: 'Photo',
  insurance: 'Insurance',
  tax: 'Tax',
  other: 'Other',
}

const TYPE_COLORS: Record<string, string> = {
  lease_agreement: 'bg-blue-50 text-blue-700 border-blue-200',
  notice: 'bg-amber-50 text-amber-700 border-amber-200',
  inspection: 'bg-violet-50 text-violet-700 border-violet-200',
  receipt: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  photo: 'bg-orange-50 text-orange-700 border-orange-200',
  insurance: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  tax: 'bg-rose-50 text-rose-700 border-rose-200',
  other: 'bg-slate-50 text-slate-700 border-slate-200',
}

const MIME_ICON: Record<string, typeof FileText> = {
  'application/pdf': FileText,
  'image/jpeg': Image,
  'image/png': Image,
  'image/webp': Image,
  'image/heic': Image,
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function TenantDocumentsPage() {
  const [documents, setDocuments] = useState<SharedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDocuments() {
      setLoading(true)

      // RLS on the documents table will filter to only shared docs
      // for the current tenant (via leases.user_id chain)
      const { data, error } = await supabase
        .from('documents')
        .select('id, title, document_type, entity_type, file_path, file_name, file_size, mime_type, created_at')
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to fetch documents:', error.message)
      }

      if (data) setDocuments(data)
      setLoading(false)
    }
    fetchDocuments()
  }, [])

  const handleDownload = async (doc: SharedDocument) => {
    setDownloadingId(doc.id)
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(doc.file_path, 60)

      if (error || !data?.signedUrl) {
        toast.error('Could not generate download link')
        return
      }
      window.open(data.signedUrl, '_blank')
    } catch {
      toast.error('Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-8">

        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-black tracking-tight">My Documents</h1>
            <p className="text-slate-500 font-medium text-sm">Documents shared with you by management.</p>
          </div>
          <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl flex items-center gap-2 shadow-sm">
            <FolderOpen size={18} className="text-blue-600" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
              {documents.length} File{documents.length !== 1 ? 's' : ''}
            </span>
          </div>
        </header>

        {/* DOCUMENT LIST */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 ml-2">
            <Clock size={16} /> Shared Documents
          </h3>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="p-20 text-center">
                <Loader2 className="animate-spin mx-auto text-blue-600" />
              </div>
            ) : documents.length === 0 ? (
              <div className="p-20 text-center">
                <AlertCircle size={40} className="mx-auto text-slate-300 mb-4" />
                <p className="text-slate-400 font-bold">No documents have been shared with you yet.</p>
                <p className="text-slate-400 text-sm mt-1">
                  Contact your property manager if you need access to documents.
                </p>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-8 py-4">Document</th>
                    <th className="px-8 py-4">Type</th>
                    <th className="px-8 py-4">Date</th>
                    <th className="px-8 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.map((doc) => {
                    const DocIcon = MIME_ICON[doc.mime_type] || File
                    const colorClasses = TYPE_COLORS[doc.document_type] || TYPE_COLORS.other
                    const typeLabel = TYPE_LABELS[doc.document_type] || doc.document_type

                    return (
                      <tr key={doc.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                              <DocIcon size={18} className="text-slate-400 group-hover:text-blue-500" />
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors text-sm">
                                {doc.title}
                              </p>
                              <p className="text-[10px] text-slate-400 font-bold">
                                {formatFileSize(doc.file_size)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <span className={`inline-flex px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${colorClasses}`}>
                            {typeLabel}
                          </span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-xs font-bold text-slate-400">
                            {new Date(doc.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <button
                            onClick={() => handleDownload(doc)}
                            disabled={downloadingId === doc.id}
                            className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            {downloadingId === doc.id
                              ? <Loader2 size={18} className="animate-spin" />
                              : <Download size={18} />
                            }
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
