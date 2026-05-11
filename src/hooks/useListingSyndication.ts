import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import { compressImage } from '@/lib/compress-image'

// ── Types ──

export type ListingStatus = 'draft' | 'published' | 'archived'
export type PetPolicy = 'allowed' | 'not_allowed' | 'case_by_case'
export type SyndicationStatus = 'active' | 'paused' | 'removed'
export type ChannelType = 'ils_feed' | 'manual'

export type UnitListing = {
  id: string
  unit_id: string
  title: string
  description: string | null
  rent_amount: number
  deposit_amount: number | null
  lease_terms: string[]
  amenities: string[]
  pet_policy: PetPolicy
  photos: string[]
  virtual_tour_url: string | null
  contact_email: string | null
  contact_phone: string | null
  status: ListingStatus
  published_at: string | null
  archived_at: string | null
  is_featured: boolean
  created_by: string
  created_at: string
  updated_at: string
  // Joined
  units?: {
    name: string
    status: string
    bedroom_count: number | null
    bathrooms: number | null
    sqft: number | null
    market_rent: number | null
    properties: {
      id: string
      name: string
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
    } | null
  }
  listing_syndications?: ListingSyndication[]
}

export type SyndicationChannel = {
  id: string
  name: string
  channel_type: ChannelType
  feed_url: string | null
  is_active: boolean
  logo_url: string | null
  created_at: string
}

export type ListingSyndication = {
  id: string
  listing_id: string
  channel_id: string
  status: SyndicationStatus
  external_url: string | null
  syndicated_at: string
  // Joined
  syndication_channels?: {
    name: string
    channel_type: ChannelType
    logo_url: string | null
  }
}

export type CreateListingPayload = {
  unit_id: string
  title: string
  description?: string
  rent_amount: number
  deposit_amount?: number
  lease_terms?: string[]
  amenities?: string[]
  pet_policy?: PetPolicy
  virtual_tour_url?: string
  contact_email?: string
  contact_phone?: string
}

export type UpdateListingPayload = Partial<CreateListingPayload> & { id: string }

// ── Constants ──

export const PET_POLICY_OPTIONS: { value: PetPolicy; label: string }[] = [
  { value: 'allowed', label: 'Pets Allowed' },
  { value: 'not_allowed', label: 'No Pets' },
  { value: 'case_by_case', label: 'Case by Case' },
]

export const LISTING_STATUS_OPTIONS: { value: ListingStatus; label: string; color: string }[] = [
  { value: 'draft', label: 'Draft', color: 'bg-amber-100 text-amber-700' },
  { value: 'published', label: 'Published', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'archived', label: 'Archived', color: 'bg-slate-100 text-slate-500' },
]

export const LEASE_TERM_OPTIONS = [
  '6 months', '9 months', '12 months', '18 months', '24 months', 'Month-to-Month',
]

export const COMMON_AMENITIES = [
  'In-Unit Washer/Dryer', 'Dishwasher', 'Central A/C', 'Hardwood Floors',
  'Stainless Steel Appliances', 'Walk-In Closet', 'Balcony/Patio', 'Garage Parking',
  'Pool Access', 'Fitness Center', 'Pet Friendly', 'EV Charging',
  'Storage Unit', 'Gated Community', 'Fireplace', 'High Ceilings',
]

// ── Fetch helpers ──

async function fetchListings(): Promise<UnitListing[]> {
  const { data, error } = await supabase
    .from('unit_listings')
    .select(`
      *,
      units!inner (
        name, status, bedroom_count, bathrooms, sqft, market_rent,
        properties ( id, name, address, city, state, zip )
      ),
      listing_syndications (
        id, channel_id, status, external_url, syndicated_at,
        syndication_channels ( name, channel_type, logo_url )
      )
    `)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as UnitListing[]
}

async function fetchChannels(): Promise<SyndicationChannel[]> {
  const { data, error } = await supabase
    .from('syndication_channels')
    .select('*')
    .order('name')

  if (error) throw error
  return (data ?? []) as SyndicationChannel[]
}

async function fetchSyndications(listingId: string): Promise<ListingSyndication[]> {
  const { data, error } = await supabase
    .from('listing_syndications')
    .select(`
      *,
      syndication_channels ( name, channel_type, logo_url )
    `)
    .eq('listing_id', listingId)
    .order('syndicated_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ListingSyndication[]
}

async function fetchVacantUnitsWithoutListings() {
  // Get units that are Vacant and don't already have a listing
  const { data, error } = await supabase
    .from('units')
    .select(`
      id, name, status, bedroom_count, bathrooms, sqft, market_rent,
      properties ( id, name, address, city )
    `)
    .eq('status', 'Vacant')

  if (error) throw error

  // Filter out units that already have listings
  const { data: existingListings } = await supabase
    .from('unit_listings')
    .select('unit_id')
    .in('status', ['draft', 'published'])

  const listedUnitIds = new Set((existingListings ?? []).map(l => l.unit_id))
  return (data ?? []).filter(u => !listedUnitIds.has(u.id))
}

// ── Query hooks ──

export function useUnitListings() {
  return useQuery({
    queryKey: ['unit-listings'],
    queryFn: fetchListings,
  })
}

export function useSyndicationChannels() {
  return useQuery({
    queryKey: ['syndication-channels'],
    queryFn: fetchChannels,
  })
}

export function useListingSyndications(listingId: string | null) {
  return useQuery({
    queryKey: ['listing-syndications', listingId],
    queryFn: () => fetchSyndications(listingId!),
    enabled: !!listingId,
  })
}

export function useVacantUnits() {
  return useQuery({
    queryKey: ['vacant-units-for-listing'],
    queryFn: fetchVacantUnitsWithoutListings,
  })
}

// ── Mutations ──

export function useListingMutations() {
  const qc = useQueryClient()

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['unit-listings'] })
    qc.invalidateQueries({ queryKey: ['listing-syndications'] })
    qc.invalidateQueries({ queryKey: ['vacant-units-for-listing'] })
  }

  const createListing = useMutation({
    mutationFn: async (payload: CreateListingPayload) => {
      const { data: user } = await supabase.auth.getUser()

      const { data, error } = await supabase
        .from('unit_listings')
        .insert({
          unit_id: payload.unit_id,
          title: payload.title,
          description: payload.description || null,
          rent_amount: payload.rent_amount,
          deposit_amount: payload.deposit_amount ?? null,
          lease_terms: payload.lease_terms || ['12 months'],
          amenities: payload.amenities || [],
          pet_policy: payload.pet_policy || 'case_by_case',
          virtual_tour_url: payload.virtual_tour_url || null,
          contact_email: payload.contact_email || null,
          contact_phone: payload.contact_phone || null,
          status: 'draft',
          created_by: user.user?.id,
        })
        .select('id')
        .single()

      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Listing created as draft')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateListing = useMutation({
    mutationFn: async ({ id, ...changes }: UpdateListingPayload) => {
      const updates: Record<string, any> = {}
      if (changes.title !== undefined) updates.title = changes.title
      if (changes.description !== undefined) updates.description = changes.description
      if (changes.rent_amount !== undefined) updates.rent_amount = changes.rent_amount
      if (changes.deposit_amount !== undefined) updates.deposit_amount = changes.deposit_amount
      if (changes.lease_terms !== undefined) updates.lease_terms = changes.lease_terms
      if (changes.amenities !== undefined) updates.amenities = changes.amenities
      if (changes.pet_policy !== undefined) updates.pet_policy = changes.pet_policy
      if (changes.virtual_tour_url !== undefined) updates.virtual_tour_url = changes.virtual_tour_url
      if (changes.contact_email !== undefined) updates.contact_email = changes.contact_email
      if (changes.contact_phone !== undefined) updates.contact_phone = changes.contact_phone

      const { error } = await supabase
        .from('unit_listings')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Listing updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteListing = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('unit_listings')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Listing deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const publishListing = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('unit_listings')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Listing published')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const archiveListing = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('unit_listings')
        .update({ status: 'archived', archived_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Listing archived')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const unarchiveListing = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('unit_listings')
        .update({ status: 'draft', archived_at: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Listing moved to draft')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const syndicateToChannel = useMutation({
    mutationFn: async ({ listing_id, channel_id }: { listing_id: string; channel_id: string }) => {
      const { error } = await supabase
        .from('listing_syndications')
        .insert({ listing_id, channel_id, status: 'active' })
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Syndication added')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const removeSyndication = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('listing_syndications')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Syndication removed')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const uploadListingPhoto = useMutation({
    mutationFn: async ({ listingId, file }: { listingId: string; file: File }) => {
      // Compress image
      const compressed = await compressImage(file)

      // Upload to storage
      const ext = compressed.name.split('.').pop() || 'jpg'
      const path = `${listingId}/${crypto.randomUUID()}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('listings')
        .upload(path, compressed, { contentType: compressed.type })

      if (uploadError) throw uploadError

      // Append path to photos array
      const { data: listing } = await supabase
        .from('unit_listings')
        .select('photos')
        .eq('id', listingId)
        .single()

      const currentPhotos = listing?.photos || []
      const { error: updateError } = await supabase
        .from('unit_listings')
        .update({ photos: [...currentPhotos, path] })
        .eq('id', listingId)

      if (updateError) throw updateError
      return path
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Photo uploaded')
    },
    onError: (err: Error) => toast.error(`Upload failed: ${err.message}`),
  })

  const removeListingPhoto = useMutation({
    mutationFn: async ({ listingId, path }: { listingId: string; path: string }) => {
      // Remove from storage
      const { error: storageError } = await supabase.storage
        .from('listings')
        .remove([path])

      if (storageError) throw storageError

      // Remove from photos array
      const { data: listing } = await supabase
        .from('unit_listings')
        .select('photos')
        .eq('id', listingId)
        .single()

      const updatedPhotos = (listing?.photos || []).filter((p: string) => p !== path)
      const { error: updateError } = await supabase
        .from('unit_listings')
        .update({ photos: updatedPhotos })
        .eq('id', listingId)

      if (updateError) throw updateError
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Photo removed')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return {
    createListing,
    updateListing,
    deleteListing,
    publishListing,
    archiveListing,
    unarchiveListing,
    syndicateToChannel,
    removeSyndication,
    uploadListingPhoto,
    removeListingPhoto,
  }
}
