import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──────────────────────────────────────────────────
export type ConversationType = 'direct' | 'announcement'

export type Participant = {
  id: string
  conversation_id: string
  user_id: string
  role: 'admin' | 'member'
  last_read_at: string
  is_muted: boolean
  joined_at: string
  // Joined from profiles
  full_name?: string
  profile_role?: string
}

export type Conversation = {
  id: string
  conversation_type: ConversationType
  subject: string | null
  property_id: string | null
  created_by: string
  last_message_at: string
  last_message_preview: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
  // Computed
  participant_count?: number
  unread?: boolean
  participants?: Participant[]
  property_name?: string
}

export type Message = {
  id: string
  conversation_id: string
  sender_id: string
  sender_name: string
  body: string
  created_at: string
}

export type ConversationFilters = {
  search?: string
  type?: ConversationType | ''
  is_archived?: boolean
}

export type CreateConversationPayload = {
  conversation_type: ConversationType
  subject: string
  participant_user_ids: string[]
  property_id?: string
  initial_message: string
}

export type RecipientOption = {
  user_id: string
  full_name: string
  role: string
  entity_label?: string // e.g. "Unit 101 - Sunset Apartments"
}

// ── Constants ──────────────────────────────────────────────
export const CONVERSATION_TYPE_OPTIONS = [
  { value: 'direct', label: 'Direct Message', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'announcement', label: 'Announcement', color: 'bg-amber-50 text-amber-700 border-amber-200' },
] as const

export const ROLE_COLORS: Record<string, string> = {
  Admin: 'bg-red-50 text-red-700 border-red-200',
  'Property Manager': 'bg-blue-50 text-blue-700 border-blue-200',
  Maintenance: 'bg-orange-50 text-orange-700 border-orange-200',
  Accounting: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Tenant: 'bg-violet-50 text-violet-700 border-violet-200',
  Owner: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  Vendor: 'bg-rose-50 text-rose-700 border-rose-200',
}

// ── Hooks ──────────────────────────────────────────────────

/** Fetch conversations the current user participates in */
export function useConversations(filters: ConversationFilters = {}) {
  return useQuery({
    queryKey: ['conversations', filters],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // 1. Get conversation IDs where user is participant
      const { data: myParticipations, error: pErr } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at, is_muted')
        .eq('user_id', user.id)

      if (pErr) throw pErr
      if (!myParticipations || myParticipations.length === 0) return []

      const convIds = myParticipations.map(p => p.conversation_id)
      const readMap = Object.fromEntries(myParticipations.map(p => [p.conversation_id, p]))

      // 2. Fetch conversations
      let query = supabase
        .from('conversations')
        .select('*')
        .in('id', convIds)
        .order('last_message_at', { ascending: false })

      if (filters.is_archived !== undefined) {
        query = query.eq('is_archived', filters.is_archived)
      } else {
        query = query.eq('is_archived', false)
      }

      if (filters.type) {
        query = query.eq('conversation_type', filters.type)
      }

      const { data: conversations, error: cErr } = await query
      if (cErr) throw cErr

      // 3. Get participant counts for all conversations
      const { data: allParticipants } = await supabase
        .from('conversation_participants')
        .select('id, conversation_id, user_id, role, last_read_at, is_muted, joined_at, profiles:user_id ( full_name, role )')
        .in('conversation_id', convIds)

      // Build participant counts and names
      const participantsByConv = new Map<string, Participant[]>()
      for (const p of allParticipants || []) {
        const list = participantsByConv.get(p.conversation_id) || []
        const profile = p.profiles as any
        list.push({
          id: p.id,
          conversation_id: p.conversation_id,
          user_id: p.user_id,
          role: p.role as 'admin' | 'member',
          last_read_at: p.last_read_at,
          is_muted: p.is_muted,
          joined_at: p.joined_at,
          full_name: profile?.full_name || 'Unknown',
          profile_role: profile?.role || 'Unknown',
        })
        participantsByConv.set(p.conversation_id, list)
      }

      // 4. Enrich conversations
      let result: Conversation[] = (conversations || []).map(conv => {
        const myPart = readMap[conv.id]
        const participants = participantsByConv.get(conv.id) || []
        const unread = myPart
          ? new Date(conv.last_message_at) > new Date(myPart.last_read_at)
          : false

        return {
          ...conv,
          participant_count: participants.length,
          unread: myPart?.is_muted ? false : unread,
          participants,
        }
      })

      // 5. Search filter (client-side on subject + participant names)
      if (filters.search) {
        const q = filters.search.toLowerCase()
        result = result.filter(c => {
          const subjectMatch = c.subject?.toLowerCase().includes(q)
          const participantMatch = c.participants?.some(p =>
            p.full_name?.toLowerCase().includes(q)
          )
          return subjectMatch || participantMatch
        })
      }

      // Sort: unread first, then by last_message_at
      result.sort((a, b) => {
        if (a.unread && !b.unread) return -1
        if (!a.unread && b.unread) return 1
        return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
      })

      return result
    },
    staleTime: 30_000,
  })
}

/** Fetch messages for a conversation */
export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversation-messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return []

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(200)

      if (error) throw error
      return (data || []) as Message[]
    },
    enabled: !!conversationId,
    staleTime: 10_000,
  })
}

/** Fetch conversation detail with participants + profiles */
export function useConversationDetail(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversation-detail', conversationId],
    queryFn: async () => {
      if (!conversationId) return null

      const { data: conv, error: cErr } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single()

      if (cErr) throw cErr

      const { data: participants, error: pErr } = await supabase
        .from('conversation_participants')
        .select('*, profiles:user_id ( full_name, role )')
        .eq('conversation_id', conversationId)

      if (pErr) throw pErr

      const enrichedParticipants: Participant[] = (participants || []).map((p: any) => ({
        ...p,
        full_name: p.profiles?.full_name || 'Unknown',
        profile_role: p.profiles?.role || 'Unknown',
      }))

      return {
        ...conv,
        participants: enrichedParticipants,
        participant_count: enrichedParticipants.length,
      } as Conversation
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  })
}

/** Count unread conversations for badge */
export function useUnreadCount() {
  return useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return 0

      const { data: myParts, error: pErr } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at, is_muted')
        .eq('user_id', user.id)
        .eq('is_muted', false)

      if (pErr || !myParts || myParts.length === 0) return 0

      const convIds = myParts.map(p => p.conversation_id)
      const { data: convs, error: cErr } = await supabase
        .from('conversations')
        .select('id, last_message_at')
        .in('id', convIds)
        .eq('is_archived', false)

      if (cErr || !convs) return 0

      let count = 0
      const readMap = Object.fromEntries(myParts.map(p => [p.conversation_id, p.last_read_at]))
      for (const conv of convs) {
        if (new Date(conv.last_message_at) > new Date(readMap[conv.id])) {
          count++
        }
      }
      return count
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

// ── Mutations ──────────────────────────────────────────────

/** Create a new conversation with participants and initial message */
export function useCreateConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateConversationPayload) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Get sender name from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()

      const senderName = profile?.full_name || 'Manager'

      // 1. Create conversation
      const { data: conv, error: cErr } = await supabase
        .from('conversations')
        .insert({
          conversation_type: payload.conversation_type,
          subject: payload.subject,
          property_id: payload.property_id || null,
          created_by: user.id,
        })
        .select()
        .single()

      if (cErr || !conv) throw cErr || new Error('Failed to create conversation')

      // 2. Build participant list (creator as admin + recipients as members)
      const allUserIds = new Set(payload.participant_user_ids)
      allUserIds.add(user.id) // ensure creator is included

      const participantRows = Array.from(allUserIds).map(uid => ({
        conversation_id: conv.id,
        user_id: uid,
        role: uid === user.id ? 'admin' : 'member',
      }))

      const { error: pErr } = await supabase
        .from('conversation_participants')
        .insert(participantRows)

      if (pErr) throw pErr

      // 3. Send initial message
      const { error: mErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conv.id,
          sender_id: user.id,
          sender_name: senderName,
          body: payload.initial_message,
        })

      if (mErr) throw mErr

      return conv
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
      toast.success('Conversation created')
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to create conversation')
    },
  })
}

/** Send a message in a conversation */
export function useSendMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ conversationId, body }: { conversationId: string; body: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()

      const senderName = profile?.full_name || 'User'

      // Insert message
      const { data: msg, error: mErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: user.id,
          sender_name: senderName,
          body,
        })
        .select()
        .single()

      if (mErr) throw mErr

      // Update sender's last_read_at
      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)

      return msg
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['conversation-messages', vars.conversationId] })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to send message')
    },
  })
}

/** Mark a conversation as read */
export function useMarkAsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['unread-count'] })
    },
  })
}

/** Archive a conversation */
export function useArchiveConversation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('conversations')
        .update({ is_archived: true })
        .eq('id', conversationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success('Conversation archived')
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to archive')
    },
  })
}

/** Toggle mute on a conversation */
export function useToggleMute() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ conversationId, muted }: { conversationId: string; muted: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('conversation_participants')
        .update({ is_muted: muted })
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      toast.success(vars.muted ? 'Conversation muted' : 'Conversation unmuted')
    },
  })
}

// ── Helpers ──────────────────────────────────────────────────

/** Fetch all users grouped by role for the recipient picker.
 *  Uses the get_recipient_options() RPC for a single efficient query
 *  instead of 3 sequential round-trips. */
export async function fetchRecipientOptions(): Promise<RecipientOption[]> {
  const { data, error } = await supabase.rpc('get_recipient_options')
  if (error || !data) return []

  return (data as any[])
    .map((p: any) => ({
      user_id: p.id,
      full_name: p.full_name || 'Unknown',
      role: p.role,
      entity_label: p.context_label || undefined,
    }))
}

/** Fetch properties for announcement scoping */
export async function fetchPropertyOptions() {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .order('name')

  if (error) throw error
  return data || []
}

/** Get user IDs for all tenants/owners linked to a property.
 *  Uses the get_property_participants() RPC for a single query
 *  instead of 4 sequential round-trips. */
export async function getPropertyParticipants(propertyId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_property_participants', {
    p_property_id: propertyId,
  })
  if (error || !data) return []
  return (data as any[]).map((r: any) => r.user_id)
}

/** Get all active tenant and owner user IDs (for global announcements) */
export async function getAllTenantOwnerUserIds(): Promise<string[]> {
  const [tenantsRes, ownersRes] = await Promise.all([
    supabase.from('tenants').select('user_id').not('user_id', 'is', null),
    supabase.from('owners').select('user_id').not('user_id', 'is', null),
  ])

  const userIds: string[] = []

  if (tenantsRes.data) {
    for (const t of tenantsRes.data) {
      if (t.user_id) userIds.push(t.user_id)
    }
  }

  if (ownersRes.data) {
    for (const o of ownersRes.data) {
      if (o.user_id) userIds.push(o.user_id)
    }
  }

  return [...new Set(userIds)]
}

/** Get the type color class */
export function getTypeColor(type: ConversationType): string {
  return CONVERSATION_TYPE_OPTIONS.find(t => t.value === type)?.color || 'bg-slate-50 text-slate-700 border-slate-200'
}

/** Get role color class */
export function getRoleColor(role: string): string {
  return ROLE_COLORS[role] || 'bg-slate-50 text-slate-700 border-slate-200'
}
