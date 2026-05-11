import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { can, canAny, canAll, isManagement, isStaff, type Permission } from '@/lib/permissions'

export function usePermissions() {
  const [role, setRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function fetchRole() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !mounted) { setLoading(false); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (mounted) {
        setRole(profile?.role || null)
        setLoading(false)
      }
    }

    fetchRole()
    return () => { mounted = false }
  }, [])

  const check = useCallback(
    (resource: string, action: Permission) => can(role, resource, action),
    [role]
  )

  const checkAny = useCallback(
    (resource: string, actions: Permission[]) => canAny(role, resource, actions),
    [role]
  )

  const checkAll = useCallback(
    (resource: string, actions: Permission[]) => canAll(role, resource, actions),
    [role]
  )

  return {
    role,
    loading,
    can: check,
    canAny: checkAny,
    canAll: checkAll,
    isManagement: isManagement(role),
    isStaff: isStaff(role),
  }
}
