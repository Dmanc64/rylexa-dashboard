'use client'

import React, { Suspense, useState, useMemo, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Megaphone, Plus, Loader2, AlertCircle, Eye, EyeOff,
  Trash2, Share2, Image as ImageIcon, MoreVertical, X,
  Bed, Bath, Maximize, DollarSign, Globe, Upload,
  CheckCircle2, Archive, Edit3, ExternalLink, Copy,
} from 'lucide-react'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useUnitListings,
  useSyndicationChannels,
  useVacantUnits,
  useListingMutations,
  PET_POLICY_OPTIONS,
  LISTING_STATUS_OPTIONS,
  LEASE_TERM_OPTIONS,
  COMMON_AMENITIES,
  type UnitListing,
  type CreateListingPayload,
  type PetPolicy,
  type ListingStatus,
} from '@/hooks/useListingSyndication'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import { toast } from 'sonner'

export default function ListingSyndicationPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    }>
      <ListingSyndicationContent />
    </Suspense>
  )
}

function ListingSyndicationContent() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()
  const { data: listings, isLoading } = useUnitListings()
  const { data: channels } = useSyndicationChannels()
  const mutations = useListingMutations()
  const searchParams = useSearchParams()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingListing, setEditingListing] = useState<UnitListing | null>(null)
  const [syndicationListingId, setSyndicationListingId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ListingStatus | 'all'>('all')
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Auto-open create modal from ?create=true (vacancy forecaster link)
  React.useEffect(() => {
    if (searchParams.get('create') === 'true' && !flagsLoading && isEnabled('listing_syndication')) {
      setShowCreateModal(true)
    }
  }, [searchParams, flagsLoading, isEnabled])

  // useMemo must be called before early returns to satisfy Rules of Hooks
  const filteredListings = useMemo(() => {
    if (!listings) return []
    if (statusFilter === 'all') return listings
    return listings.filter(l => l.status === statusFilter)
  }, [listings, statusFilter])

  const publishedCount = listings?.filter(l => l.status === 'published').length || 0
  const draftCount = listings?.filter(l => l.status === 'draft').length || 0
  const syndicatedCount = listings?.filter(l => (l.listing_syndications?.length || 0) > 0).length || 0

  // Feature flag early returns (after all hooks)
  if (flagsLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    )
  }

  if (!isEnabled('listing_syndication')) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <AlertCircle size={48} className="text-slate-300" />
        <p className="text-slate-400 font-bold text-sm">Listing Syndication is currently disabled.</p>
        <p className="text-slate-400 text-xs">Enable the &quot;listing_syndication&quot; feature flag in Settings.</p>
      </div>
    )
  }

  const handleEdit = (listing: UnitListing) => {
    setEditingListing(listing)
    setShowCreateModal(true)
    setOpenMenuId(null)
  }

  const handleDelete = (id: string) => {
    if (confirm('Delete this listing? This cannot be undone.')) {
      mutations.deleteListing.mutate(id)
    }
    setOpenMenuId(null)
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      <div className="max-w-[1400px] mx-auto">

        {/* HEADER */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Marketing</p>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
              Listing <span className="text-blue-600">Syndication</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              {publishedCount} Published · {draftCount} Draft
            </p>
          </div>
          <button
            onClick={() => { setEditingListing(null); setShowCreateModal(true) }}
            className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all shadow-lg active:scale-95"
          >
            <Plus size={16} /> New Listing
          </button>
        </div>

        {/* STATS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Listings', value: listings?.length || 0, icon: Megaphone, color: 'text-blue-600 bg-blue-50' },
            { label: 'Published', value: publishedCount, icon: Globe, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Syndicated', value: syndicatedCount, icon: Share2, color: 'text-violet-600 bg-violet-50' },
            { label: 'Channels', value: channels?.filter(c => c.is_active).length || 0, icon: ExternalLink, color: 'text-amber-600 bg-amber-50' },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${stat.color}`}>
                  <stat.icon size={18} />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{stat.label}</p>
              </div>
              <p className="text-3xl font-black text-slate-900">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* FILTERS */}
        <div className="flex items-center gap-2 mb-6">
          {(['all', 'published', 'draft', 'archived'] as const).map(tab => {
            const count = tab === 'all' ? listings?.length || 0
              : listings?.filter(l => l.status === tab).length || 0
            return (
              <button
                key={tab}
                onClick={() => setStatusFilter(tab)}
                className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                  statusFilter === tab
                    ? 'bg-slate-900 text-white shadow-lg'
                    : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab === 'all' ? 'All' : tab} ({count})
              </button>
            )
          })}
        </div>

        {/* CONTENT */}
        {isLoading ? (
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-20 text-center">
            <Loader2 size={32} className="animate-spin mx-auto text-blue-500 mb-3" />
            <p className="text-slate-400 font-bold text-sm">Loading listings...</p>
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-20 text-center">
            <Megaphone size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500 font-bold text-lg mb-2">
              {statusFilter === 'all' ? 'No Listings Yet' : `No ${statusFilter} Listings`}
            </p>
            <p className="text-slate-400 text-sm mb-6">Create listings to market your vacant units across platforms.</p>
            {statusFilter === 'all' && (
              <button
                onClick={() => { setEditingListing(null); setShowCreateModal(true) }}
                className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all"
              >
                <Plus size={16} /> Create Your First Listing
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredListings.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                onEdit={() => handleEdit(listing)}
                onDelete={() => handleDelete(listing.id)}
                onPublish={() => mutations.publishListing.mutate(listing.id)}
                onArchive={() => mutations.archiveListing.mutate(listing.id)}
                onUnarchive={() => mutations.unarchiveListing.mutate(listing.id)}
                onManageChannels={() => { setSyndicationListingId(listing.id); setOpenMenuId(null) }}
                menuOpen={openMenuId === listing.id}
                onMenuToggle={() => setOpenMenuId(openMenuId === listing.id ? null : listing.id)}
              />
            ))}
          </div>
        )}

        {/* LISTING BUILDER MODAL */}
        <ListingBuilderModal
          isOpen={showCreateModal}
          onClose={() => { setShowCreateModal(false); setEditingListing(null) }}
          listing={editingListing}
          mutations={mutations}
        />

        {/* SYNDICATION CHANNEL MODAL */}
        {syndicationListingId && (
          <SyndicationChannelModal
            isOpen={!!syndicationListingId}
            onClose={() => setSyndicationListingId(null)}
            listingId={syndicationListingId}
            channels={channels || []}
            mutations={mutations}
          />
        )}
      </div>
    </div>
  )
}

// ── Listing Card ──
function ListingCard({
  listing, onEdit, onDelete, onPublish, onArchive, onUnarchive, onManageChannels,
  menuOpen, onMenuToggle,
}: {
  listing: UnitListing
  onEdit: () => void; onDelete: () => void
  onPublish: () => void; onArchive: () => void; onUnarchive: () => void
  onManageChannels: () => void
  menuOpen: boolean; onMenuToggle: () => void
}) {
  const unit = listing.units
  const property = unit?.properties
  const statusOpt = LISTING_STATUS_OPTIONS.find(o => o.value === listing.status)
  const photoUrl = listing.photos?.[0]
    ? supabase.storage.from('listings').getPublicUrl(listing.photos[0]).data.publicUrl
    : null

  const syndicationCount = listing.listing_syndications?.length || 0

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden group hover:shadow-md transition-shadow">
      {/* Photo */}
      <div className="relative h-44 bg-slate-100 overflow-hidden">
        {photoUrl ? (
          <img src={photoUrl} alt={listing.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon size={40} className="text-slate-300" />
          </div>
        )}
        {/* Status badge */}
        <span className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${statusOpt?.color || 'bg-slate-100 text-slate-500'}`}>
          {statusOpt?.label || listing.status}
        </span>
        {listing.is_featured && (
          <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-amber-100 text-amber-700">
            Featured
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-slate-900 truncate text-sm">{listing.title}</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider truncate">
              {property?.name} · Unit {unit?.name}
            </p>
          </div>
          <div className="relative shrink-0 ml-2">
            <button onClick={onMenuToggle} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <MoreVertical size={14} className="text-slate-400" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 bg-white border border-slate-200 rounded-xl shadow-xl z-20 w-44 py-1">
                <button onClick={onEdit} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                  <Edit3 size={14} /> Edit
                </button>
                {listing.status === 'draft' && (
                  <button onClick={onPublish} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 flex items-center gap-2 text-emerald-600">
                    <Eye size={14} /> Publish
                  </button>
                )}
                {listing.status === 'published' && (
                  <button onClick={onArchive} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                    <Archive size={14} /> Archive
                  </button>
                )}
                {listing.status === 'archived' && (
                  <button onClick={onUnarchive} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                    <EyeOff size={14} /> Move to Draft
                  </button>
                )}
                <button onClick={onManageChannels} className="w-full text-left px-4 py-2.5 text-sm font-medium hover:bg-slate-50 flex items-center gap-2">
                  <Share2 size={14} /> Channels
                </button>
                <hr className="my-1 border-slate-100" />
                <button onClick={onDelete} className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                  <span className="flex items-center gap-2"><Trash2 size={14} /> Delete</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">
          {unit?.bedroom_count != null && (
            <span className="flex items-center gap-1"><Bed size={10} /> {unit.bedroom_count} Bed</span>
          )}
          {unit?.bathrooms != null && (
            <span className="flex items-center gap-1"><Bath size={10} /> {unit.bathrooms} Bath</span>
          )}
          {unit?.sqft != null && (
            <span className="flex items-center gap-1"><Maximize size={10} /> {unit.sqft.toLocaleString()} sqft</span>
          )}
        </div>

        {/* Rent */}
        <div className="flex items-center justify-between">
          <p className="text-lg font-black text-slate-900">
            ${listing.rent_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-xs font-bold text-slate-400">/mo</span>
          </p>
          {syndicationCount > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded-lg">
              <Globe size={10} className="text-blue-600" />
              <span className="text-[10px] font-black text-blue-700">{syndicationCount} channel{syndicationCount !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        {/* Syndication pills */}
        {listing.listing_syndications && listing.listing_syndications.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {listing.listing_syndications.map(s => (
              <span key={s.id} className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-100 text-slate-600">
                {s.syndication_channels?.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Listing Builder Modal ──
function ListingBuilderModal({
  isOpen, onClose, listing, mutations,
}: {
  isOpen: boolean; onClose: () => void
  listing: UnitListing | null
  mutations: ReturnType<typeof useListingMutations>
}) {
  const isEdit = !!listing
  const { data: vacantUnits, isLoading: unitsLoading } = useVacantUnits()

  const [unitId, setUnitId] = useState(listing?.unit_id || '')
  const [title, setTitle] = useState(listing?.title || '')
  const [description, setDescription] = useState(listing?.description || '')
  const [rentAmount, setRentAmount] = useState(listing?.rent_amount?.toString() || '')
  const [depositAmount, setDepositAmount] = useState(listing?.deposit_amount?.toString() || '')
  const [leaseTerms, setLeaseTerms] = useState<string[]>(listing?.lease_terms || ['12 months'])
  const [amenities, setAmenities] = useState<string[]>(listing?.amenities || [])
  const [petPolicy, setPetPolicy] = useState<PetPolicy>(listing?.pet_policy || 'case_by_case')
  const [virtualTourUrl, setVirtualTourUrl] = useState(listing?.virtual_tour_url || '')
  const [contactEmail, setContactEmail] = useState(listing?.contact_email || '')
  const [contactPhone, setContactPhone] = useState(listing?.contact_phone || '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setUnitId(listing?.unit_id || '')
      setTitle(listing?.title || '')
      setDescription(listing?.description || '')
      setRentAmount(listing?.rent_amount?.toString() || '')
      setDepositAmount(listing?.deposit_amount?.toString() || '')
      setLeaseTerms(listing?.lease_terms || ['12 months'])
      setAmenities(listing?.amenities || [])
      setPetPolicy(listing?.pet_policy || 'case_by_case')
      setVirtualTourUrl(listing?.virtual_tour_url || '')
      setContactEmail(listing?.contact_email || '')
      setContactPhone(listing?.contact_phone || '')
    }
  }, [isOpen, listing])

  // Auto-generate title when unit is selected
  const handleUnitChange = (id: string) => {
    setUnitId(id)
    const unit = vacantUnits?.find(u => u.id === id)
    if (unit && !title) {
      const prop = unit.properties as any
      setTitle(`${prop?.name || 'Property'} - Unit ${unit.name}`)
      if (unit.market_rent && !rentAmount) {
        setRentAmount(unit.market_rent.toString())
      }
    }
  }

  const toggleLeaseTerm = (term: string) => {
    setLeaseTerms(prev =>
      prev.includes(term) ? prev.filter(t => t !== term) : [...prev, term]
    )
  }

  const toggleAmenity = (amenity: string) => {
    setAmenities(prev =>
      prev.includes(amenity) ? prev.filter(a => a !== amenity) : [...prev, amenity]
    )
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!listing?.id || !e.target.files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(e.target.files)) {
        await mutations.uploadListingPhoto.mutateAsync({ listingId: listing.id, file })
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemovePhoto = (path: string) => {
    if (!listing?.id) return
    mutations.removeListingPhoto.mutate({ listingId: listing.id, path })
  }

  const canSave = (isEdit || unitId) && title.trim() && Number(rentAmount) > 0

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: CreateListingPayload = {
        unit_id: unitId,
        title: title.trim(),
        description: description.trim() || undefined,
        rent_amount: Number(rentAmount),
        deposit_amount: Number(depositAmount) || undefined,
        lease_terms: leaseTerms.length > 0 ? leaseTerms : ['12 months'],
        amenities,
        pet_policy: petPolicy,
        virtual_tour_url: virtualTourUrl.trim() || undefined,
        contact_email: contactEmail.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
      }

      if (isEdit && listing) {
        await mutations.updateListing.mutateAsync({ id: listing.id, ...payload })
      } else {
        await mutations.createListing.mutateAsync(payload)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const labelCls = 'block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5'
  const inputCls = 'w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500'
  const selectCls = `${inputCls} appearance-none`

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? 'Edit Listing' : 'Create Listing'}
      subtitle="Build a listing to market your vacant unit"
      size="max-w-2xl"
    >
      <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* Unit Selection (only for new) */}
        {!isEdit && (
          <div>
            <label className={labelCls}>Select Vacant Unit</label>
            {unitsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" /> Loading vacant units...
              </div>
            ) : !vacantUnits?.length ? (
              <p className="text-sm text-slate-400">No vacant units available without existing listings.</p>
            ) : (
              <select value={unitId} onChange={e => handleUnitChange(e.target.value)} className={selectCls}>
                <option value="">Choose a unit...</option>
                {vacantUnits.map(u => {
                  const prop = u.properties as any
                  return (
                    <option key={u.id} value={u.id}>
                      {prop?.name} — Unit {u.name}
                      {u.bedroom_count ? ` (${u.bedroom_count} BR` : ''}
                      {u.bathrooms ? `, ${u.bathrooms} BA)` : u.bedroom_count ? ')' : ''}
                    </option>
                  )
                })}
              </select>
            )}
          </div>
        )}

        {/* Title */}
        <div>
          <label className={labelCls}>Listing Title</label>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Sunny 2BR at Riverside Manor" className={inputCls} />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Describe the unit features, neighborhood, nearby amenities..." className={`${inputCls} resize-none`} />
        </div>

        {/* Rent & Deposit */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Monthly Rent ($)</label>
            <input type="number" value={rentAmount} onChange={e => setRentAmount(e.target.value)} placeholder="2000" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Security Deposit ($)</label>
            <input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="2000" className={inputCls} />
          </div>
        </div>

        {/* Lease Terms */}
        <div>
          <label className={labelCls}>Lease Terms</label>
          <div className="flex flex-wrap gap-2">
            {LEASE_TERM_OPTIONS.map(term => (
              <button
                key={term}
                type="button"
                onClick={() => toggleLeaseTerm(term)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  leaseTerms.includes(term)
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {term}
              </button>
            ))}
          </div>
        </div>

        {/* Pet Policy */}
        <div>
          <label className={labelCls}>Pet Policy</label>
          <div className="flex gap-2">
            {PET_POLICY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPetPolicy(opt.value)}
                className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  petPolicy === opt.value
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Amenities */}
        <div>
          <label className={labelCls}>Amenities</label>
          <div className="flex flex-wrap gap-2">
            {COMMON_AMENITIES.map(amenity => (
              <button
                key={amenity}
                type="button"
                onClick={() => toggleAmenity(amenity)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                  amenities.includes(amenity)
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {amenity}
              </button>
            ))}
          </div>
        </div>

        {/* Photos (only for existing listings) */}
        {isEdit && listing && (
          <div>
            <label className={labelCls}>Photos</label>
            <div className="space-y-3">
              {/* Existing photos */}
              {listing.photos && listing.photos.length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {listing.photos.map(path => {
                    const url = supabase.storage.from('listings').getPublicUrl(path).data.publicUrl
                    return (
                      <div key={path} className="relative group aspect-square rounded-xl overflow-hidden bg-slate-100">
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemovePhoto(path)}
                          className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              {/* Upload button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-slate-300 rounded-xl text-sm font-bold text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-all"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {uploading ? 'Uploading...' : 'Upload Photos'}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic"
                multiple
                onChange={handlePhotoUpload}
                className="hidden"
              />
            </div>
          </div>
        )}

        {/* Virtual Tour */}
        <div>
          <label className={labelCls}>Virtual Tour URL (optional)</label>
          <input type="url" value={virtualTourUrl} onChange={e => setVirtualTourUrl(e.target.value)} placeholder="https://..." className={inputCls} />
        </div>

        {/* Contact */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Contact Info</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="leasing@company.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="(555) 123-4567" className={inputCls} />
            </div>
          </div>
        </div>

        {!isEdit && (
          <p className="text-xs text-slate-400 italic">
            💡 You can upload photos after saving the listing as a draft.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors">
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all disabled:opacity-40"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Save Changes' : 'Save as Draft'}
        </button>
      </div>
    </AccessibleModal>
  )
}

// ── Syndication Channel Modal ──
function SyndicationChannelModal({
  isOpen, onClose, listingId, channels, mutations,
}: {
  isOpen: boolean; onClose: () => void
  listingId: string
  channels: { id: string; name: string; channel_type: string; feed_url: string | null; is_active: boolean }[]
  mutations: ReturnType<typeof useListingMutations>
}) {
  const { data: listings } = useUnitListings()
  const listing = listings?.find(l => l.id === listingId)
  const activeSyndications = listing?.listing_syndications || []

  const getChannelSyndication = (channelId: string) =>
    activeSyndications.find(s => s.channel_id === channelId)

  const handleToggle = async (channelId: string) => {
    const existing = getChannelSyndication(channelId)
    if (existing) {
      await mutations.removeSyndication.mutateAsync(existing.id)
    } else {
      await mutations.syndicateToChannel.mutateAsync({ listing_id: listingId, channel_id: channelId })
    }
  }

  const feedUrl = typeof window !== 'undefined'
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/listing-feed`
    : ''

  const copyFeedUrl = () => {
    navigator.clipboard.writeText(feedUrl)
    toast.success('Feed URL copied to clipboard')
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Syndication Channels"
      subtitle="Choose where to publish this listing"
      size="max-w-lg"
    >
      <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
        {listing?.status !== 'published' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs font-medium text-amber-700">
            ⚠️ This listing must be published before it appears on syndication channels.
          </div>
        )}

        {/* ILS Feed URL */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-2">ILS Feed URL</p>
          <p className="text-xs text-blue-700 mb-2">Share this URL with ILS partners to syndicate all published listings:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-white rounded-lg text-xs text-blue-800 font-mono truncate border border-blue-200">
              {feedUrl}
            </code>
            <button onClick={copyFeedUrl} className="shrink-0 p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <Copy size={14} />
            </button>
          </div>
        </div>

        {/* Channel list */}
        {channels.filter(c => c.is_active).map(channel => {
          const syndication = getChannelSyndication(channel.id)
          const isActive = !!syndication

          return (
            <div key={channel.id} className="flex items-center gap-4 p-4 bg-white border border-slate-200 rounded-xl">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                {channel.channel_type === 'ils_feed' ? (
                  <Globe size={18} className="text-blue-600" />
                ) : (
                  <Share2 size={18} className="text-violet-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-slate-900">{channel.name}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {channel.channel_type === 'ils_feed' ? 'ILS Feed' : 'Manual'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleToggle(channel.id)}
                className="shrink-0"
                title={isActive ? 'Remove from channel' : 'Add to channel'}
              >
                <div className={`relative w-11 h-6 rounded-full transition-colors ${isActive ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isActive ? 'translate-x-5' : ''}`} />
                </div>
              </button>
            </div>
          )
        })}
      </div>

      <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
        <button type="button" onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors">
          Done
        </button>
      </div>
    </AccessibleModal>
  )
}
