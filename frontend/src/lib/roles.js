/**
 * RentFlow RBAC helpers.
 *
 * Roles:
 * - admin   — full system control
 * - manager — store operations + reports + audit (no user admin)
 * - cashier — front-desk / warehouse AGENT (day-to-day only)
 */

export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  CASHIER: 'cashier', // Agent
};

/** Agent = cashier front-desk / warehouse staff */
export function isAgent(role) {
  return role === ROLES.CASHIER;
}

export function isManagerOrAdmin(role) {
  return role === ROLES.ADMIN || role === ROLES.MANAGER;
}

export function isAdmin(role) {
  return role === ROLES.ADMIN;
}

/**
 * What each role may see in the sidebar / open via URL.
 */
export const SECTION_ROLES = {
  dashboard: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER],
  inventory: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER], // agents: view only
  customers: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER],
  bookings: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER],
  returns: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER],
  payments: [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER],
  reports: [ROLES.ADMIN, ROLES.MANAGER], // not agent
  settings: [ROLES.ADMIN, ROLES.MANAGER], // not agent
};

/**
 * Fine-grained actions (UI + should match API).
 */
export const can = {
  viewReports: (role) => isManagerOrAdmin(role),
  viewSettings: (role) => isManagerOrAdmin(role),
  manageUsers: (role) => isAdmin(role),
  editStorePolicies: (role) => isAdmin(role),
  createInventory: (role) => isManagerOrAdmin(role),
  adjustStock: (role) => isManagerOrAdmin(role),
  deleteInventory: (role) => isAdmin(role),
  cancelBooking: (role) => isManagerOrAdmin(role),
  setDeposit: (role) => isAdmin(role),
  approvePayment: (role) => isManagerOrAdmin(role),
  viewRevenueCharts: (role) => isManagerOrAdmin(role),
  deleteCustomer: (role) => isAdmin(role),
};

export function roleLabel(role) {
  if (role === ROLES.CASHIER) return 'Agent';
  if (role === ROLES.MANAGER) return 'Manager';
  if (role === ROLES.ADMIN) return 'Admin';
  return role || '—';
}

export const AGENT_SECTIONS = [
  'Dashboard',
  'Inventory (view / lookup only)',
  'Customers',
  'Schedule & Bookings',
  'Return Equipment',
  'Payments & Receipts (record only — no approve)',
];

export const AGENT_HIDDEN = [
  'Reports & Analytics',
  'Settings & Audit',
  'Add / edit catalog items',
  'Stock overrides',
  'Delete inventory or customers',
  'Cancel bookings',
  'Approve / reject payments',
  'User & role management',
];
