/**
 * Static route knowledge base for the Rylexa PM Dashboard.
 *
 * Every navigable route is defined here with its description, allowed roles,
 * features, and suggested questions. The app-assistant edge function uses
 * this to provide context-aware navigation help.
 *
 * Source of truth: AdminSidebar.tsx menuItems, portal layouts, page files.
 */

export interface ModalAction {
  modalId: string
  label: string
  description: string
  keywords: string[]
}

export interface RouteEntry {
  path: string
  name: string
  description: string
  keywords: string[]
  portal: 'admin' | 'portal' | 'vendor-portal' | 'owner-portal'
  allowedRoles: string[]
  suggestedQuestions: string[]
  features: string[]
  relatedRoutes: string[]
  modals?: ModalAction[]
}

export const ROUTE_MAP: RouteEntry[] = [
  // ── ADMIN PORTAL ──────────────────────────────────────────────────────

  {
    path: '/admin',
    name: 'Dashboard',
    description: 'Command center with quick links to all major sections, activity feed, occupancy stats, and compliance status.',
    keywords: ['dashboard', 'home', 'overview', 'command center', 'activity feed'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'What sections can I access from here?',
      'How do I view recent activity?',
      'Where is the portfolio map?',
    ],
    features: [
      'View occupancy and revenue stats',
      'Access all major sections via quick links',
      'View real-time activity feed',
      'Check compliance audit status',
    ],
    relatedRoutes: ['/admin/properties', '/admin/maintenance', '/admin/finance'],
  },
  {
    path: '/admin/tenants',
    name: 'Residents',
    description: 'Tenant directory with search, status filtering (Active/Past/Lead), and tenant profiles.',
    keywords: ['tenants', 'residents', 'people', 'directory', 'tenant list'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I search for a tenant?',
      'How do I view a tenant profile?',
      'What do the status filters mean?',
    ],
    features: [
      'Search tenants by name or email',
      'Filter by status: Active, Past, Lead',
      'View tenant profiles with lease and payment history',
      'Navigate to individual tenant detail pages',
    ],
    relatedRoutes: ['/admin/leases', '/admin/applications', '/admin/onboarding'],
  },
  {
    path: '/admin/leases',
    name: 'Leases',
    description: 'Lease archive with property filtering, affordability housing fields, insurance tracking, and lease management.',
    keywords: ['leases', 'lease archive', 'rental agreements', 'contracts'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I create a new lease?',
      'How do I filter leases by property?',
      'Where can I manage lease templates?',
    ],
    features: [
      'View and filter leases by property',
      'Create, edit, and end leases',
      'Move tenants between units',
      'Track affordability and insurance details',
      'Send leases for e-signing',
    ],
    modals: [
      { modalId: 'new-lease', label: 'New Lease', description: 'Create a new lease agreement', keywords: ['create lease', 'new lease', 'add lease'] },
    ],
    relatedRoutes: ['/admin/leases/templates', '/admin/tenants', '/admin/applications'],
  },
  {
    path: '/admin/leases/templates',
    name: 'Lease Templates',
    description: 'Create and manage reusable lease templates with custom clauses, addendums, and utility responsibility settings.',
    keywords: ['templates', 'lease templates', 'clauses', 'addendums'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I create a lease template?',
      'How do I add clauses to a template?',
      'What are addendums?',
    ],
    features: [
      'Create and edit lease templates',
      'Add, reorder, and toggle clause required status',
      'Configure pet and parking addendums',
      'Set utility responsibility',
      'Set a default template',
    ],
    relatedRoutes: ['/admin/leases'],
  },
  {
    path: '/admin/maintenance',
    name: 'Work Orders',
    description: 'Maintenance hub for creating, triaging, and tracking work orders with AI-powered categorization and vendor assignment.',
    keywords: ['maintenance', 'work orders', 'repairs', 'tickets', 'fix', 'broken'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Maintenance'],
    suggestedQuestions: [
      'How do I create a work order?',
      'How does AI triage work?',
      'How do I assign a vendor to a ticket?',
    ],
    features: [
      'Create and manage work orders',
      'AI-powered triage (auto-categorize and prioritize)',
      'Assign vendors to work orders',
      'Track costs: labor, materials, invoices',
      'Upload photos and add update notes',
      'View maintenance calendar',
      'Manage recurring maintenance jobs',
    ],
    modals: [
      { modalId: 'new-ticket', label: 'New Work Order', description: 'Create a new maintenance work order', keywords: ['create work order', 'new ticket', 'submit repair', 'new maintenance'] },
    ],
    relatedRoutes: ['/admin/maintenance/turns', '/admin/vendors', '/admin/approvals'],
  },
  {
    path: '/admin/maintenance/turns',
    name: 'Unit Turns',
    description: 'Kanban board tracking unit make-readies from move-out to rent-ready with task management and vendor assignment.',
    keywords: ['turns', 'make-ready', 'unit turnover', 'renovation', 'kanban'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I start a unit turn?',
      'How do I track turn progress?',
      'How do I assign vendors to turn tasks?',
    ],
    features: [
      'Create unit turns with task lists',
      'Drag tasks across kanban columns',
      'Assign vendors to tasks',
      'Track costs and progress percentage',
      'Create work orders from turn tasks',
    ],
    relatedRoutes: ['/admin/maintenance', '/admin/vendors'],
  },
  {
    path: '/admin/finance',
    name: 'Finance',
    description: 'Financial performance dashboard with P&L by property, revenue metrics, and maintenance expense tracking.',
    keywords: ['finance', 'money', 'revenue', 'expenses', 'profit', 'loss', 'financial', 'accounting'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I view profit and loss?',
      'Where do I run billing?',
      'How do I reconcile transactions?',
    ],
    features: [
      'View P&L metrics by property',
      'Track revenue, expenses, and NOI',
      'View asset performance table',
      'Monitor maintenance expenses',
    ],
    relatedRoutes: ['/admin/finance/billing', '/admin/finance/reconcile', '/admin/finance/distributions'],
  },
  {
    path: '/admin/finance/billing',
    name: 'Billing',
    description: 'Execute rent, utility, and late fee billing runs with configurable grace periods and automatic posting.',
    keywords: ['billing', 'rent', 'charges', 'late fees', 'utilities', 'post rent'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I run a billing cycle?',
      'How do late fees work?',
      'How do I set grace periods?',
    ],
    features: [
      'Run rent billing for specific dates',
      'Configure grace periods and late fee types',
      'Run utility and late fee billing',
      'View billing run history',
      'Toggle automatic posting',
    ],
    modals: [
      { modalId: 'run-billing', label: 'Run Billing', description: 'Start a new billing run for rent or utilities', keywords: ['run billing', 'post rent', 'charge rent', 'billing run'] },
    ],
    relatedRoutes: ['/admin/finance', '/admin/finance/statements'],
  },
  {
    path: '/admin/finance/reconcile',
    name: 'Reconciliation',
    description: 'Match bank transactions to tenant/vendor accounts with AI-powered auto-categorization.',
    keywords: ['reconcile', 'reconciliation', 'bank', 'transactions', 'matching', 'categorize'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I reconcile a transaction?',
      'How does AI categorization work?',
      'How do I flag a suspicious transaction?',
    ],
    features: [
      'Reconcile bank transactions to accounts',
      'Flag suspicious transactions for review',
      'Run AI auto-categorization (Gemini)',
      'View reconciliation stats',
    ],
    relatedRoutes: ['/admin/finance', '/admin/finance/billing'],
  },
  {
    path: '/admin/finance/distributions',
    name: 'Distributions',
    description: 'Process owner payouts via ACH batch transfers based on property financial performance.',
    keywords: ['distributions', 'owner payouts', 'ACH', 'dividends', 'payments to owners'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I process a distribution?',
      'Which properties are eligible?',
      'How do I view distribution history?',
    ],
    features: [
      'Select eligible properties for distribution',
      'Review available distribution amounts',
      'Execute batch ACH transfers',
      'View distribution history',
    ],
    relatedRoutes: ['/admin/finance', '/admin/owners'],
  },
  {
    path: '/admin/finance/payroll',
    name: 'Payroll',
    description: 'Review and export payroll data for staff and contractors with CSV download.',
    keywords: ['payroll', 'wages', 'hours', 'salary', 'contractor', 'export'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I export payroll?',
      'How do I approve a payroll run?',
      'How do I filter payees?',
    ],
    features: [
      'Approve payroll runs',
      'Filter by status and region',
      'Search payees by name',
      'Download CSV exports',
    ],
    relatedRoutes: ['/admin/finance'],
  },
  {
    path: '/admin/finance/statements',
    name: 'Statements',
    description: 'View and download tenant billing statements filtered by property and year.',
    keywords: ['statements', 'billing history', 'tenant statements', 'PDF'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I download a statement?',
      'How do I filter by property?',
    ],
    features: [
      'Search and filter statements by property and year',
      'Download statement PDFs',
      'View outstanding balances and collected totals',
    ],
    relatedRoutes: ['/admin/finance', '/admin/finance/billing'],
  },
  {
    path: '/admin/finance/budgets',
    name: 'Budgets',
    description: 'Create and manage property budgets with budget-vs-actual comparisons and forecasting.',
    keywords: ['budgets', 'budget', 'forecast', 'actual vs budget', 'spending'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I create a budget?',
      'How do I compare budget vs actuals?',
      'How does forecasting work?',
    ],
    features: [
      'Create and edit budget line items',
      'Lock finalized budgets',
      'View budget vs actual charts',
      'Run spending forecasts',
      'Set budget defaults',
    ],
    relatedRoutes: ['/admin/finance'],
  },
  {
    path: '/admin/finance/ap',
    name: 'Accounts Payable',
    description: 'Track vendor invoices and bills payable with approval workflows and aging reports.',
    keywords: ['accounts payable', 'AP', 'invoices', 'bills', 'vendor payments'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I create a new bill?',
      'How do I approve a bill?',
      'How do I track aging invoices?',
    ],
    features: [
      'Create and manage vendor bills',
      'Approve bills for payment',
      'Record payments and void bills',
      'Filter by status and vendor',
      'Track aging buckets',
    ],
    modals: [
      { modalId: 'new-bill', label: 'New Bill', description: 'Create a new accounts payable bill', keywords: ['create bill', 'new bill', 'add bill', 'new invoice'] },
    ],
    relatedRoutes: ['/admin/finance', '/admin/vendors'],
  },
  {
    path: '/admin/finance/ar-agent',
    name: 'AR Agent',
    description: 'Autonomous collections agent that sends reminders, applies late fees, and escalates past-due balances.',
    keywords: ['AR', 'accounts receivable', 'collections', 'past due', 'reminders', 'late', 'delinquent'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I run the AR workflow?',
      'How do I pause collections for a tenant?',
      'What are the escalation steps?',
    ],
    features: [
      'Run automated collections workflow',
      'View AR actions: reminders, late fees, demand letters, escalations',
      'Pause collections for specific tenants',
      'Filter actions by type and status',
    ],
    relatedRoutes: ['/admin/finance', '/admin/tenants'],
  },
  {
    path: '/admin/vendors',
    name: 'Vendors',
    description: 'Vendor directory with performance tracking, ratings, trade type management, and status controls.',
    keywords: ['vendors', 'contractors', 'service providers', 'trades', 'plumber', 'electrician'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I add a new vendor?',
      'How do I review vendor performance?',
      'How do I flag a vendor as do-not-use?',
    ],
    features: [
      'Add, edit, and deactivate vendors',
      'Track vendor performance and ratings',
      'Manage trade types',
      'Toggle do-not-use status',
      'View assigned work orders per vendor',
    ],
    modals: [
      { modalId: 'new-vendor', label: 'Add Vendor', description: 'Add a new vendor to the system', keywords: ['add vendor', 'new vendor', 'create vendor', 'register vendor'] },
    ],
    relatedRoutes: ['/admin/maintenance', '/admin/finance/ap'],
  },
  {
    path: '/admin/owners',
    name: 'Owners',
    description: 'Property owner management with contact info, property assignments, and distribution tracking.',
    keywords: ['owners', 'property owners', 'landlords', 'investors'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I add an owner?',
      'How do I assign properties to owners?',
      'Where do I process owner payouts?',
    ],
    features: [
      'Add and edit owner profiles',
      'Assign properties to owners',
      'View owner distribution history',
    ],
    modals: [
      { modalId: 'new-owner', label: 'Add Owner', description: 'Add a new property owner', keywords: ['add owner', 'new owner', 'create owner'] },
    ],
    relatedRoutes: ['/admin/finance/distributions', '/admin/properties'],
  },
  {
    path: '/admin/documents',
    name: 'Documents',
    description: 'Document management system for uploading, organizing, and retrieving property and lease documents.',
    keywords: ['documents', 'files', 'upload', 'storage', 'paperwork'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I upload a document?',
      'How do I find a specific document?',
    ],
    features: [
      'Upload and organize documents',
      'Associate documents with properties or tenants',
      'Download and preview files',
    ],
    relatedRoutes: ['/admin/leases', '/admin/inspections'],
  },
  {
    path: '/admin/inspections',
    name: 'Inspections',
    description: 'Property inspection management for move-in, move-out, and routine inspections with photo documentation.',
    keywords: ['inspections', 'move-in', 'move-out', 'walkthrough', 'condition report'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I schedule an inspection?',
      'How do I add photos to an inspection?',
    ],
    features: [
      'Create move-in and move-out inspections',
      'Upload photos and notes per room',
      'Generate inspection reports',
      'Track inspection history',
    ],
    relatedRoutes: ['/admin/documents', '/admin/properties'],
  },
  {
    path: '/admin/compliance',
    name: 'Compliance',
    description: 'Compliance dashboard tracking regulatory requirements, certifications, and eviction cases.',
    keywords: ['compliance', 'regulatory', 'certifications', 'legal'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'What compliance items need attention?',
      'Where do I manage evictions?',
    ],
    features: [
      'View compliance status overview',
      'Track regulatory requirements',
      'Access eviction case management',
    ],
    relatedRoutes: ['/admin/compliance/evictions', '/admin/inspections'],
  },
  {
    path: '/admin/compliance/evictions',
    name: 'Evictions',
    description: 'Manage eviction cases from notice served through judgment, tracking dates, costs, and status transitions.',
    keywords: ['evictions', 'evict', 'notice', 'judgment', 'legal action'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I start an eviction case?',
      'What are the eviction status steps?',
    ],
    features: [
      'Create eviction cases',
      'Track status: Notice Served, Filed, Judgment',
      'Record dates and costs',
      'Manage case details and notes',
    ],
    relatedRoutes: ['/admin/compliance', '/admin/tenants'],
  },
  {
    path: '/admin/messages',
    name: 'Messages',
    description: 'Team and tenant messaging with direct messages, group conversations, and announcements.',
    keywords: ['messages', 'messaging', 'communicate', 'inbox', 'send message', 'email'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I send a message to a tenant?',
      'How do I create an announcement?',
    ],
    features: [
      'Send direct and group messages',
      'Create property-scoped conversations',
      'Send announcements to all tenants',
      'Track read status',
      'Mute and archive conversations',
    ],
    relatedRoutes: ['/admin/chat'],
  },
  {
    path: '/admin/chat',
    name: 'Team Chat',
    description: 'Real-time team chat with channels for general, maintenance, urgent, and accounting topics.',
    keywords: ['chat', 'team chat', 'channels', 'real-time', 'instant message'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'What channels are available?',
      'How do I use team chat?',
    ],
    features: [
      'Join topic channels: #general, #maintenance, #urgent, #accounting',
      'Real-time message delivery',
      'View online team members',
    ],
    relatedRoutes: ['/admin/messages'],
  },
  {
    path: '/admin/listings/syndication',
    name: 'Listings',
    description: 'Listing syndication to publish available units to rental platforms and track listing performance.',
    keywords: ['listings', 'syndication', 'advertise', 'vacancies', 'rental listings', 'publish'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I publish a listing?',
      'How do I track listing views?',
    ],
    features: [
      'Publish unit listings to rental platforms',
      'Manage listing photos and descriptions',
      'Track listing performance',
    ],
    relatedRoutes: ['/admin/leasing-crm', '/admin/properties'],
  },
  {
    path: '/admin/leasing-crm',
    name: 'Leasing CRM',
    description: 'Lead and prospect management with pipeline tracking for the leasing process.',
    keywords: ['CRM', 'leads', 'prospects', 'leasing pipeline', 'sales', 'funnel'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I add a new lead?',
      'How do I track prospect progress?',
    ],
    features: [
      'Add and manage leads',
      'Track prospects through the leasing pipeline',
      'Schedule tours',
      'Convert leads to applications',
    ],
    relatedRoutes: ['/admin/applications', '/admin/listings/syndication'],
  },
  {
    path: '/admin/applications',
    name: 'Applications',
    description: 'Incoming tenant application review with screening, approval, and denial workflows.',
    keywords: ['applications', 'apply', 'screening', 'applicant', 'approve', 'deny'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I review an application?',
      'How do I approve an applicant?',
      'What happens when I approve?',
    ],
    features: [
      'Review incoming applications',
      'Run tenant screening',
      'Approve applications (auto-creates tenant, lease, and marks unit occupied)',
      'Deny applications with notes',
    ],
    relatedRoutes: ['/admin/tenants', '/admin/leases', '/admin/leasing-crm'],
  },
  {
    path: '/admin/approvals',
    name: 'Cost Approvals',
    description: 'Review and approve pending maintenance labor and material costs before posting to the ledger.',
    keywords: ['approvals', 'approve costs', 'pending', 'review', 'expenses'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'What costs are pending approval?',
      'How do I approve an expense?',
    ],
    features: [
      'View pending cost approvals',
      'Approve or reject expense logs',
      'See unposted receipt totals',
    ],
    relatedRoutes: ['/admin/maintenance', '/admin/finance'],
  },
  {
    path: '/admin/audit',
    name: 'AI Audit',
    description: 'Lease intelligence dashboard using AI to extract and verify rent amounts, deposits, and dates from lease PDFs.',
    keywords: ['audit', 'AI audit', 'lease intelligence', 'document analysis', 'extract', 'verify'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How does AI lease analysis work?',
      'How do I upload a lease for analysis?',
      'What discrepancies does it detect?',
    ],
    features: [
      'Upload lease PDFs for AI analysis',
      'Extract rent, deposit, and end date via AI',
      'Compare AI extraction vs system records',
      'View discrepancy reports',
    ],
    relatedRoutes: ['/admin/leases', '/admin/documents'],
  },
  {
    path: '/admin/analytics/scorecard',
    name: 'Analytics',
    description: 'Property performance scorecards and portfolio analytics dashboards.',
    keywords: ['analytics', 'scorecard', 'performance', 'metrics', 'KPIs'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'What metrics are tracked?',
      'How do I compare property performance?',
    ],
    features: [
      'View property performance scorecards',
      'Compare metrics across properties',
      'Track KPIs over time',
    ],
    relatedRoutes: ['/admin/reports', '/admin/finance'],
  },
  {
    path: '/admin/reports',
    name: 'Reports',
    description: 'Generate and schedule financial, occupancy, and operational reports with export options.',
    keywords: ['reports', 'report', 'generate', 'export', 'download', 'schedule report'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager', 'Accounting'],
    suggestedQuestions: [
      'How do I generate a report?',
      'How do I schedule recurring reports?',
      'What report types are available?',
    ],
    features: [
      'Generate on-demand reports',
      'Schedule recurring report delivery',
      'Export in multiple formats',
      'Filter by property and date range',
    ],
    relatedRoutes: ['/admin/finance', '/admin/analytics/scorecard'],
  },
  {
    path: '/admin/properties',
    name: 'Properties',
    description: 'Regional property portfolio with unit management, occupancy rates, and map visualization.',
    keywords: ['properties', 'buildings', 'portfolio', 'units', 'real estate'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I view property details?',
      'How do I manage units?',
      'Where is the portfolio map?',
    ],
    features: [
      'View property list with occupancy metrics',
      'Manage individual units within properties',
      'View property details, photos, and map',
      'Track projected revenue',
    ],
    relatedRoutes: ['/admin/portfolio-map', '/admin/tenants', '/admin/leases'],
  },
  {
    path: '/admin/portfolio-map',
    name: 'Portfolio Map',
    description: 'Interactive Mapbox map showing all properties with location-based visualization.',
    keywords: ['map', 'portfolio map', 'location', 'geographic', 'mapbox'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I use the portfolio map?',
    ],
    features: [
      'View all properties on an interactive map',
      'Click properties for quick details',
    ],
    relatedRoutes: ['/admin/properties'],
  },
  {
    path: '/admin/onboarding',
    name: 'Onboarding',
    description: 'New tenant intake workflow with duplicate detection and resident account activation.',
    keywords: ['onboarding', 'new tenant', 'intake', 'activate', 'setup'],
    portal: 'admin',
    allowedRoles: ['Admin', 'Property Manager'],
    suggestedQuestions: [
      'How do I onboard a new tenant?',
      'How does duplicate detection work?',
    ],
    features: [
      'Enter new tenant information',
      'Automatic duplicate detection',
      'Activate resident accounts',
    ],
    relatedRoutes: ['/admin/tenants', '/admin/applications'],
  },
  {
    path: '/admin/settings/audit-log',
    name: 'Audit Trail',
    description: 'Complete change history showing who modified what record and when, with filtering and search.',
    keywords: ['audit trail', 'audit log', 'history', 'changes', 'who changed'],
    portal: 'admin',
    allowedRoles: ['Admin'],
    suggestedQuestions: [
      'How do I search the audit log?',
      'How do I filter by user or table?',
    ],
    features: [
      'View all system changes with timestamps',
      'Filter by table, action, user, date range',
      'Search by record ID',
    ],
    relatedRoutes: ['/admin/settings/users'],
  },
  {
    path: '/admin/settings/users',
    name: 'User Management',
    description: 'Manage staff accounts, assign roles, create new users, and control access.',
    keywords: ['users', 'user management', 'accounts', 'roles', 'access', 'permissions', 'staff'],
    portal: 'admin',
    allowedRoles: ['Admin'],
    suggestedQuestions: [
      'How do I create a new user?',
      'How do I change someone\'s role?',
      'How do I disable an account?',
    ],
    features: [
      'Create staff accounts by role',
      'Link tenants to leases',
      'Disable and enable user accounts',
      'Reset passwords',
      'Delete accounts',
    ],
    relatedRoutes: ['/admin/settings/assignments', '/admin/settings/policies'],
  },
  {
    path: '/admin/settings/assignments',
    name: 'Assignments',
    description: 'Link users to specific properties and units for scoped access control.',
    keywords: ['assignments', 'assign', 'property access', 'unit access', 'link user'],
    portal: 'admin',
    allowedRoles: ['Admin'],
    suggestedQuestions: [
      'How do I assign a user to a property?',
    ],
    features: [
      'Select user, property, and unit',
      'Create asset assignment links',
      'Manage access scopes',
    ],
    relatedRoutes: ['/admin/settings/users'],
  },
  {
    path: '/admin/settings/policies',
    name: 'Policies',
    description: 'Create property-level policies that are surfaced to the tenant AI assistant for automated answers.',
    keywords: ['policies', 'rules', 'property rules', 'pet policy', 'parking policy'],
    portal: 'admin',
    allowedRoles: ['Admin'],
    suggestedQuestions: [
      'How do I create a policy?',
      'How are policies used by the AI?',
    ],
    features: [
      'Add and edit policies by category',
      'Assign policies to properties',
      'Activate and deactivate policies',
      'Policies are surfaced to tenant AI for automated answers',
    ],
    relatedRoutes: ['/admin/settings/users'],
  },

  // ── TENANT PORTAL ─────────────────────────────────────────────────────

  {
    path: '/portal',
    name: 'Tenant Dashboard',
    description: 'Tenant home with rent info, payment processing, lease details, open repairs, and account balance.',
    keywords: ['tenant dashboard', 'home', 'my account', 'rent', 'pay rent'],
    portal: 'portal',
    allowedRoles: ['Tenant'],
    suggestedQuestions: [
      'How do I pay my rent?',
      'Where can I see my balance?',
      'How do I set up autopay?',
    ],
    features: [
      'View rent and lease details',
      'Make payments with saved cards',
      'Set up autopay',
      'View open maintenance requests',
      'See payment history and ledger',
      'Accept lease renewals',
    ],
    relatedRoutes: ['/portal/repairs', '/portal/documents', '/portal/statements'],
  },
  {
    path: '/portal/repairs',
    name: 'Repairs',
    description: 'Submit and track maintenance repair requests with photo uploads and status updates.',
    keywords: ['repairs', 'maintenance', 'fix', 'broken', 'request repair'],
    portal: 'portal',
    allowedRoles: ['Tenant'],
    suggestedQuestions: [
      'How do I submit a repair request?',
      'How do I check repair status?',
    ],
    features: [
      'Submit new repair requests',
      'Upload photos of issues',
      'Track request status',
      'Add updates to existing requests',
    ],
    modals: [
      { modalId: 'new-repair', label: 'New Repair Request', description: 'Submit a new maintenance repair request', keywords: ['submit repair', 'new repair', 'report issue', 'something broken'] },
    ],
    relatedRoutes: ['/portal'],
  },
  {
    path: '/portal/messages',
    name: 'Messages',
    description: 'Message management office and property team.',
    keywords: ['messages', 'contact', 'inbox', 'communicate'],
    portal: 'portal',
    allowedRoles: ['Tenant'],
    suggestedQuestions: [
      'How do I contact the office?',
    ],
    features: [
      'Send messages to property management',
      'View message history',
    ],
    relatedRoutes: ['/portal'],
  },
  {
    path: '/portal/documents',
    name: 'Documents',
    description: 'Access lease documents, agreements, and property documents.',
    keywords: ['documents', 'lease', 'files', 'paperwork', 'agreement'],
    portal: 'portal',
    allowedRoles: ['Tenant'],
    suggestedQuestions: [
      'Where is my lease?',
      'How do I download a document?',
    ],
    features: [
      'View and download lease documents',
      'Access property documents',
    ],
    relatedRoutes: ['/portal'],
  },
  {
    path: '/portal/statements',
    name: 'Statements',
    description: 'View payment history and download billing statements.',
    keywords: ['statements', 'payment history', 'billing', 'receipts'],
    portal: 'portal',
    allowedRoles: ['Tenant'],
    suggestedQuestions: [
      'How do I download a statement?',
      'Where is my payment history?',
    ],
    features: [
      'View payment history',
      'Download billing statements',
    ],
    relatedRoutes: ['/portal'],
  },
  {
    path: '/portal/settings',
    name: 'Settings',
    description: 'Manage tenant account settings and preferences.',
    keywords: ['settings', 'account', 'preferences', 'profile'],
    portal: 'portal',
    allowedRoles: ['Tenant'],
    suggestedQuestions: [
      'How do I update my profile?',
    ],
    features: [
      'Update personal information',
      'Manage notification preferences',
    ],
    relatedRoutes: ['/portal'],
  },

  // ── VENDOR PORTAL ─────────────────────────────────────────────────────

  {
    path: '/vendor-portal',
    name: 'Vendor Dashboard',
    description: 'Mobile-first vendor dashboard with assigned jobs, open bids, performance stats, and work logging.',
    keywords: ['vendor dashboard', 'jobs', 'assigned work', 'my jobs'],
    portal: 'vendor-portal',
    allowedRoles: ['Vendor'],
    suggestedQuestions: [
      'How do I accept a job?',
      'How do I submit an invoice?',
      'How do I log work hours?',
    ],
    features: [
      'View and manage assigned jobs',
      'Accept or reject work orders',
      'Mark jobs as completed',
      'Submit invoices for completed work',
      'Add updates with photos, hours, and materials costs',
      'View and submit bids on available jobs',
    ],
    relatedRoutes: ['/vendor-portal/log-work', '/vendor-portal/messages'],
  },
  {
    path: '/vendor-portal/log-work',
    name: 'Log Work',
    description: 'Log work hours, materials, and progress notes for assigned jobs.',
    keywords: ['log work', 'hours', 'timesheet', 'materials', 'progress'],
    portal: 'vendor-portal',
    allowedRoles: ['Vendor'],
    suggestedQuestions: [
      'How do I log my hours?',
      'How do I add material costs?',
    ],
    features: [
      'Log hours worked',
      'Record material costs',
      'Add progress notes',
      'Upload photos',
    ],
    relatedRoutes: ['/vendor-portal'],
  },
  {
    path: '/vendor-portal/availability',
    name: 'Availability',
    description: 'Set your schedule and availability for job assignments.',
    keywords: ['availability', 'schedule', 'calendar', 'available'],
    portal: 'vendor-portal',
    allowedRoles: ['Vendor'],
    suggestedQuestions: [
      'How do I update my availability?',
    ],
    features: [
      'Set available days and times',
      'Block out unavailable periods',
    ],
    relatedRoutes: ['/vendor-portal'],
  },
  {
    path: '/vendor-portal/messages',
    name: 'Messages',
    description: 'Communicate with property management about jobs and assignments.',
    keywords: ['messages', 'contact', 'communicate'],
    portal: 'vendor-portal',
    allowedRoles: ['Vendor'],
    suggestedQuestions: [
      'How do I message the property manager?',
    ],
    features: [
      'Send and receive messages',
      'Discuss job details with management',
    ],
    relatedRoutes: ['/vendor-portal'],
  },

  // ── OWNER PORTAL ──────────────────────────────────────────────────────

  {
    path: '/owner-portal',
    name: 'Owner Dashboard',
    description: 'Owner overview with property count, occupancy rates, income/expenses, NOI, and distribution history.',
    keywords: ['owner dashboard', 'overview', 'NOI', 'income', 'my properties'],
    portal: 'owner-portal',
    allowedRoles: ['Owner'],
    suggestedQuestions: [
      'What is my net operating income?',
      'How do I view my distributions?',
      'What is my occupancy rate?',
    ],
    features: [
      'View property count and occupancy rates',
      'Track monthly income and expenses',
      'See net operating income (NOI)',
      'View total lifetime distributions',
      'See recent distribution history',
    ],
    relatedRoutes: ['/owner-portal/properties', '/owner-portal/distributions'],
  },
  {
    path: '/owner-portal/properties',
    name: 'My Properties',
    description: 'View owned properties with unit details and occupancy information.',
    keywords: ['properties', 'my properties', 'buildings', 'units'],
    portal: 'owner-portal',
    allowedRoles: ['Owner'],
    suggestedQuestions: [
      'How many units do I have?',
      'What is the occupancy for each property?',
    ],
    features: [
      'View owned properties',
      'See unit details and occupancy',
    ],
    relatedRoutes: ['/owner-portal'],
  },
  {
    path: '/owner-portal/distributions',
    name: 'Distributions',
    description: 'View and track owner distribution payouts with history and amounts.',
    keywords: ['distributions', 'payouts', 'dividends', 'earnings'],
    portal: 'owner-portal',
    allowedRoles: ['Owner'],
    suggestedQuestions: [
      'When is my next distribution?',
      'How much have I received total?',
    ],
    features: [
      'View distribution history',
      'Track payout amounts and dates',
      'See distribution status',
    ],
    relatedRoutes: ['/owner-portal'],
  },
  {
    path: '/owner-portal/statements',
    name: 'Financial Statements',
    description: 'Access property financial statements and performance reports.',
    keywords: ['statements', 'financials', 'reports', 'performance'],
    portal: 'owner-portal',
    allowedRoles: ['Owner'],
    suggestedQuestions: [
      'Where are my financial reports?',
    ],
    features: [
      'View property financial statements',
      'Download performance reports',
    ],
    relatedRoutes: ['/owner-portal'],
  },
  {
    path: '/owner-portal/documents',
    name: 'Documents',
    description: 'Access ownership documents, agreements, and property records.',
    keywords: ['documents', 'files', 'agreements', 'records'],
    portal: 'owner-portal',
    allowedRoles: ['Owner'],
    suggestedQuestions: [
      'Where are my documents?',
    ],
    features: [
      'View and download ownership documents',
      'Access property agreements',
    ],
    relatedRoutes: ['/owner-portal'],
  },
  {
    path: '/owner-portal/messages',
    name: 'Messages',
    description: 'Communicate with property management team.',
    keywords: ['messages', 'contact', 'communicate'],
    portal: 'owner-portal',
    allowedRoles: ['Owner'],
    suggestedQuestions: [
      'How do I contact management?',
    ],
    features: [
      'Send and receive messages',
      'Communicate with property management',
    ],
    relatedRoutes: ['/owner-portal'],
  },
  {
    path: '/owner-portal/inspections',
    name: 'Inspections',
    description: 'View property inspection reports and condition assessments.',
    keywords: ['inspections', 'condition', 'reports'],
    portal: 'owner-portal',
    allowedRoles: ['Owner'],
    suggestedQuestions: [
      'Where are inspection reports?',
    ],
    features: [
      'View inspection reports',
      'See property condition assessments',
    ],
    relatedRoutes: ['/owner-portal/properties'],
  },
]

/**
 * Get routes filtered by user role.
 */
export function getRoutesForRole(role: string): RouteEntry[] {
  return ROUTE_MAP.filter(r => r.allowedRoles.includes(role))
}

/**
 * Find route entry by path.
 */
export function findRoute(path: string): RouteEntry | undefined {
  // Exact match first
  const exact = ROUTE_MAP.find(r => r.path === path)
  if (exact) return exact

  // Try parent path (e.g., /admin/properties/abc → /admin/properties)
  const segments = path.split('/')
  while (segments.length > 2) {
    segments.pop()
    const parent = ROUTE_MAP.find(r => r.path === segments.join('/'))
    if (parent) return parent
  }

  return undefined
}

/**
 * Build a compact route summary string for the AI system prompt.
 */
export function buildRouteContext(role: string): string {
  const routes = getRoutesForRole(role)
  return routes.map(r => {
    let entry = `- **${r.name}** (${r.path}): ${r.description}\n  Features: ${r.features.join('; ')}`
    if (r.modals?.length) {
      entry += `\n  Actions: ${r.modals.map(m => `${m.label} [modalId: ${m.modalId}]`).join('; ')}`
    }
    return entry
  }).join('\n')
}

/**
 * Find a modal action matching keywords, filtered by role.
 */
export function findModalAction(role: string, keywords: string[]): { route: RouteEntry; modal: ModalAction } | undefined {
  const routes = getRoutesForRole(role)
  for (const route of routes) {
    if (!route.modals) continue
    for (const modal of route.modals) {
      const matches = keywords.some(k =>
        modal.keywords.some(mk => mk.includes(k.toLowerCase())) ||
        modal.label.toLowerCase().includes(k.toLowerCase())
      )
      if (matches) return { route, modal }
    }
  }
  return undefined
}
