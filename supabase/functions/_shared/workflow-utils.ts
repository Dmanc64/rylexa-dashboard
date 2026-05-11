/**
 * Shared utilities for the workflow automation engine.
 *
 * - resolveEntityContext: loads full context for template substitution
 * - substituteTemplate: replaces {{placeholder}} variables in templates
 * - evaluateCondition: evaluates skip-logic conditions against entity state
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface EntityContext {
  tenant_id?: string;
  tenant_name?: string;
  tenant_email?: string;
  tenant_phone?: string;
  lease_id?: string;
  lease_end_date?: string;
  rent_amount?: number;
  balance_due?: number;
  property_id?: string;
  property_name?: string;
  unit_id?: string;
  unit_name?: string;
  work_order_id?: string;
  work_order_title?: string;
  work_order_status?: string;
  work_order_category?: string;
  [key: string]: unknown;
}

/**
 * Load full context for a given entity type and ID.
 * Resolves related tenant, lease, property, unit, and balance info.
 */
export async function resolveEntityContext(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string
): Promise<EntityContext> {
  const ctx: EntityContext = {};

  if (entityType === 'tenant' || entityType === 'lease') {
    // Load lease details view which has tenant + property + unit info
    const col = entityType === 'tenant' ? 'tenant_id' : 'id';
    const { data: lease } = await supabase
      .from('lease_details_view')
      .select('*')
      .eq(col, entityId)
      .eq('status', 'Active')
      .limit(1)
      .maybeSingle();

    if (lease) {
      ctx.tenant_id = lease.tenant_id;
      ctx.tenant_name = lease.tenant_name || lease.first_name;
      ctx.tenant_email = lease.tenant_email || lease.email;
      ctx.tenant_phone = lease.tenant_phone || lease.phone;
      ctx.lease_id = lease.id || lease.lease_id;
      ctx.lease_end_date = lease.end_date;
      ctx.rent_amount = lease.rent_amount;
      ctx.property_id = lease.property_id;
      ctx.property_name = lease.property_name;
      ctx.unit_id = lease.unit_id;
      ctx.unit_name = lease.unit_number || lease.unit_name;
    }

    // Calculate balance
    if (ctx.lease_id) {
      const { data: balanceData } = await supabase
        .rpc('get_tenant_balance', { p_lease_id: ctx.lease_id });
      ctx.balance_due = balanceData ?? 0;
    }
  }

  if (entityType === 'work_order') {
    const { data: wo } = await supabase
      .from('work_orders')
      .select('id, title, description, status, priority, category, unit_id, vendor_id')
      .eq('id', entityId)
      .single();

    if (wo) {
      ctx.work_order_id = wo.id;
      ctx.work_order_title = wo.title;
      ctx.work_order_status = wo.status;
      ctx.work_order_category = wo.category;
      ctx.unit_id = wo.unit_id;

      // Load unit → property chain
      if (wo.unit_id) {
        const { data: unit } = await supabase
          .from('units')
          .select('id, unit_number, property_id, properties(id, name)')
          .eq('id', wo.unit_id)
          .single();

        if (unit) {
          ctx.unit_name = unit.unit_number;
          ctx.property_id = unit.property_id;
          ctx.property_name = (unit as any).properties?.name;
        }
      }

      // Load tenant from active lease on the unit
      if (ctx.unit_id) {
        const { data: lease } = await supabase
          .from('leases')
          .select('id, tenant_id, tenants(first_name, last_name, email, phone)')
          .eq('unit_id', ctx.unit_id)
          .eq('status', 'Active')
          .limit(1)
          .maybeSingle();

        if (lease) {
          ctx.lease_id = lease.id;
          ctx.tenant_id = lease.tenant_id;
          const t = (lease as any).tenants;
          if (t) {
            ctx.tenant_name = `${t.first_name} ${t.last_name}`.trim();
            ctx.tenant_email = t.email;
            ctx.tenant_phone = t.phone;
          }
        }
      }
    }
  }

  if (entityType === 'unit') {
    const { data: unit } = await supabase
      .from('units')
      .select('id, unit_number, property_id, properties(id, name)')
      .eq('id', entityId)
      .single();

    if (unit) {
      ctx.unit_id = unit.id;
      ctx.unit_name = unit.unit_number;
      ctx.property_id = unit.property_id;
      ctx.property_name = (unit as any).properties?.name;
    }
  }

  return ctx;
}

/**
 * Replace {{placeholder}} variables in a template string with context values.
 * Unmatched placeholders are left as-is.
 */
export function substituteTemplate(
  template: string,
  context: EntityContext
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = context[key];
    if (val === undefined || val === null) return match;
    return String(val);
  });
}

export interface ConditionConfig {
  check: string;       // field name in context (e.g., "work_order_status", "balance_due")
  operator?: string;   // "eq" | "neq" | "gt" | "lt" | "gte" | "lte" — defaults to "eq"
  expected: unknown;   // value to compare against
  action_if_match?: string;  // "skip_next" | "continue" — what to do if condition IS met
}

/**
 * Evaluate a condition against the current entity context.
 * Returns true if the condition is met.
 */
export function evaluateCondition(
  config: ConditionConfig,
  context: EntityContext
): boolean {
  const actual = context[config.check];
  const expected = config.expected;
  const op = config.operator || 'eq';

  switch (op) {
    case 'eq':  return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt':  return Number(actual) > Number(expected);
    case 'lt':  return Number(actual) < Number(expected);
    case 'gte': return Number(actual) >= Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    default:    return actual === expected;
  }
}
