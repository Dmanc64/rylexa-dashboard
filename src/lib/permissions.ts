// ─── Centralized RBAC Permission Config ───
// Single source of truth for what each role can do.
// Used by usePermissions hook, page components, and server actions.

export type Permission = 'view' | 'create' | 'edit' | 'delete' | 'approve'
export type Role = 'Admin' | 'Property Manager' | 'Accounting' | 'Maintenance' | 'Vendor' | 'Owner' | 'Tenant'

type PermissionMap = Partial<Record<string, Permission[]>>

// ─── RESOURCE PERMISSIONS PER ROLE ───
const PERMISSIONS: Record<Role, PermissionMap> = {
  Admin: {
    dashboard:      ['view'],
    properties:     ['view', 'create', 'edit', 'delete'],
    units:          ['view', 'create', 'edit', 'delete'],
    leases:         ['view', 'create', 'edit', 'delete', 'approve'],
    tenants:        ['view', 'create', 'edit', 'delete'],
    work_orders:    ['view', 'create', 'edit', 'delete', 'approve'],
    finance:        ['view', 'create', 'edit', 'delete', 'approve'],
    vendors:        ['view', 'create', 'edit', 'delete'],
    owners:         ['view', 'create', 'edit', 'delete'],
    documents:      ['view', 'create', 'edit', 'delete'],
    inspections:    ['view', 'create', 'edit', 'delete'],
    compliance:     ['view', 'create', 'edit', 'delete'],
    messages:       ['view', 'create'],
    listings:       ['view', 'create', 'edit', 'delete'],
    leasing_crm:    ['view', 'create', 'edit', 'delete'],
    ai_audit:       ['view'],
    analytics:      ['view'],
    reports:        ['view', 'create'],
    settings:       ['view', 'edit'],
    audit_trail:    ['view'],
    users:          ['view', 'create', 'edit', 'delete'],
    invoices:       ['view', 'approve'],
    bids:           ['view', 'approve'],
    distributions:  ['view', 'create', 'edit', 'approve'],
    payroll:        ['view', 'create', 'edit'],
  },

  'Property Manager': {
    dashboard:      ['view'],
    properties:     ['view', 'create', 'edit'],
    units:          ['view', 'create', 'edit'],
    leases:         ['view', 'create', 'edit', 'approve'],
    tenants:        ['view', 'create', 'edit'],
    work_orders:    ['view', 'create', 'edit', 'approve'],
    finance:        ['view', 'create', 'edit'],
    vendors:        ['view', 'create', 'edit'],
    owners:         ['view', 'create', 'edit'],
    documents:      ['view', 'create', 'edit'],
    inspections:    ['view', 'create', 'edit'],
    compliance:     ['view', 'create', 'edit'],
    messages:       ['view', 'create'],
    listings:       ['view', 'create', 'edit'],
    leasing_crm:    ['view', 'create', 'edit'],
    ai_audit:       ['view'],
    analytics:      ['view'],
    reports:        ['view', 'create'],
    invoices:       ['view', 'approve'],
    bids:           ['view', 'approve'],
    distributions:  ['view', 'create', 'edit', 'approve'],
    payroll:        ['view', 'create', 'edit'],
  },

  Accounting: {
    finance:        ['view', 'create', 'edit'],
    reports:        ['view', 'create'],
    leases:         ['view'],           // Read-only for AR/billing context
    vendors:        ['view'],           // Read-only for AP invoice verification
    invoices:       ['view'],
    distributions:  ['view'],
    payroll:        ['view'],
    properties:     ['view'],
    units:          ['view'],
  },

  Maintenance: {
    work_orders:    ['view', 'edit'],   // Can update status, log hours, add photos
    properties:     ['view'],           // Context for repairs
    units:          ['view'],           // Context for repairs
    inspections:    ['view'],           // Move-in/move-out inspections
    vendors:        ['view'],           // Coordination
    documents:      ['view'],           // Maintenance manuals
  },

  Vendor: {
    work_orders:    ['view', 'edit'],   // Own assigned orders only (RLS-scoped)
    bids:           ['view', 'create', 'edit'],  // Own bids only
    invoices:       ['view', 'create'], // Submit invoices
    messages:       ['view', 'create'],
  },

  Owner: {
    properties:     ['view'],           // Own properties only (RLS-scoped)
    units:          ['view'],           // Own units with occupancy status
    distributions:  ['view'],
    documents:      ['view'],
    inspections:    ['view'],
    messages:       ['view', 'create'],
    finance:        ['view'],           // Own property financials only
  },

  Tenant: {
    work_orders:    ['view', 'create'], // Own unit only, no Emergency priority
    documents:      ['view'],           // Own lease documents only
    messages:       ['view', 'create'],
    leases:         ['view'],           // Own lease only
    finance:        ['view'],           // Own payment history
  },
}

// ─── HELPER FUNCTIONS ───

/** Check if a role has a specific permission on a resource */
export function can(role: string | null, resource: string, action: Permission): boolean {
  if (!role) return false
  const rolePerms = PERMISSIONS[role as Role]
  if (!rolePerms) return false
  const resourcePerms = rolePerms[resource]
  if (!resourcePerms) return false
  return resourcePerms.includes(action)
}

/** Check if a role has any of the specified permissions on a resource */
export function canAny(role: string | null, resource: string, actions: Permission[]): boolean {
  return actions.some(action => can(role, resource, action))
}

/** Check if a role has all of the specified permissions on a resource */
export function canAll(role: string | null, resource: string, actions: Permission[]): boolean {
  return actions.every(action => can(role, resource, action))
}

/** Get all permissions a role has on a resource */
export function getPermissions(role: string | null, resource: string): Permission[] {
  if (!role) return []
  const rolePerms = PERMISSIONS[role as Role]
  if (!rolePerms) return []
  return rolePerms[resource] || []
}

/** Check if role is management (Admin or Property Manager) */
export function isManagement(role: string | null): boolean {
  return role === 'Admin' || role === 'Property Manager'
}

/** Check if role is staff (Admin, PM, Maintenance, or Accounting) */
export function isStaff(role: string | null): boolean {
  return ['Admin', 'Property Manager', 'Maintenance', 'Accounting'].includes(role || '')
}
