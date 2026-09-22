/**
 * PRODX POS - Realistic Mock API Adapter
 * 
 * NOTICE / BOUNDARY ADVISORY:
 * This is an in-memory client mock adapter designed strictly for the frontend
 * foundation phase. It is NOT a production backend and MUST NOT be called production.
 * In a production deployment, this is replaced by network calls to the NestJS + PostgreSQL API.
 */

import {
  IAuthApi,
  ICatalogApi,
  IOrderApi,
  IShiftApi,
  IAuditApi,
  ISyncApi,
  LoginRequest,
  CheckoutRequest,
  CheckoutResponse,
} from './types';
import {
  User,
  SessionContext,
  Store,
  Organization,
  ROLE_PERMISSIONS,
  getStoredStaffDirectory,
  getStoredRolePermissions,
  getStoredStaffPins,
  getStoredStaffPasswords,
  DEFAULT_STAFF_DIRECTORY,
} from '../domain/auth';
import {
  Product,
  Category,
  InventoryLedgerEntry,
  StockMovementReason,
  BulkImportItem,
  BulkImportMode,
  BulkImportResult,
  BatchPriceAdjustmentParams,
  BatchPriceAdjustmentResult,
  BatchPriceAdjustmentItemResult,
} from '../domain/catalog';
import { Order, CartLineItem, CartTotals, TenderPayment } from '../domain/order';
import { Shift, CashMovement, CashMovementType, computeExpectedDrawerCash, TimeclockRecord } from '../domain/shift';
import { AuditLogEntry, AuditAction, AuditSeverity } from '../domain/audit';
import { OutboxItem } from '../domain/sync';
import { Money, createMoney, ZERO_USD, addMoney, subtractMoney } from '../domain/money';
import {
  saveProducts,
  getCachedProducts,
  saveCategories,
  getCachedCategories,
  saveOrders,
  saveSingleOrder,
  getCachedOrders,
  clearAllCachedData,
} from '../lib/indexedDb';

const LOG_PREFIX = '[MOCK ADAPTER - NOT PRODUCTION BACKEND]';

// Seed Organization & Stores
const SEED_STORES: Store[] = [
  {
    id: 'store-flagship-downtown',
    organizationId: 'org-prodx-retail',
    code: 'STR-01',
    name: 'Flagship Downtown',
    address: '742 Evergreen Blvd, Suite 100, Metro City',
    phone: '+66 2 123 4567',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    defaultTaxRateBps: 700, // 7% VAT
  },
  {
    id: 'store-uptown-express',
    organizationId: 'org-prodx-retail',
    code: 'STR-02',
    name: 'Uptown Express',
    address: '1204 Grand Avenue, Metro City',
    phone: '+66 2 123 4568',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    defaultTaxRateBps: 700, // 7% VAT
  },
];

const SEED_ORG: Organization = {
  id: 'org-prodx-retail',
  name: 'PRODX Retail Group',
  slug: 'prodx',
  stores: SEED_STORES,
};

// Seed Users with distinct RBAC roles
export const SEED_USERS: User[] = [
  {
    id: 'usr-admin-alex',
    name: 'Alex Vance',
    email: 'alex.vance@prodx.io',
    role: 'admin',
    employeeCode: 'EMP-001',
    permissions: ROLE_PERMISSIONS.admin,
  },
  {
    id: 'usr-manager-sarah',
    name: 'Sarah Connor',
    email: 'sarah.connor@prodx.io',
    role: 'manager',
    employeeCode: 'EMP-014',
    permissions: ROLE_PERMISSIONS.manager,
  },
  {
    id: 'usr-cashier-john',
    name: 'John Doe',
    email: 'john.doe@prodx.io',
    role: 'cashier',
    employeeCode: 'EMP-108',
    permissions: ROLE_PERMISSIONS.cashier,
  },
];

// Seed Categories
const SEED_CATEGORIES: Category[] = [
  { id: 'cat-all', name: 'All Products', slug: 'all' },
  { id: 'cat-coffee', name: 'Artisan Coffee', slug: 'coffee', color: '#B45309' },
  { id: 'cat-beverages', name: 'Cold Drinks', slug: 'beverages', color: '#0284C7' },
  { id: 'cat-bakery', name: 'Fresh Bakery', slug: 'bakery', color: '#D97706' },
  { id: 'cat-retail', name: 'Retail & Merch', slug: 'retail', color: '#4F46E5' },
  { id: 'cat-beans', name: 'Roasted Beans', slug: 'beans', color: '#78350F' },
];

// Seed Products with decimal-safe integer cents
const SEED_PRODUCTS: Product[] = [
  {
    id: 'prod-espresso',
    storeId: 'store-flagship-downtown',
    sku: 'BEV-ESP-01',
    barcode: '890123450001',
    name: 'Double Espresso',
    description: 'Double shot of single-origin Ethiopian washed beans.',
    categoryId: 'cat-coffee',
    price: createMoney(6500), // ฿65.00
    costPrice: createMoney(1500), // ฿15.00
    taxRateBps: 700, // 7% VAT
    currentStock: 140,
    reorderPoint: 25,
    unitOfMeasure: 'cup',
  },
  {
    id: 'prod-latte',
    storeId: 'store-flagship-downtown',
    sku: 'BEV-LAT-02',
    barcode: '890123450002',
    name: 'Oat Milk Latte (12oz)',
    description: 'Espresso with micro-foamed organic oat milk.',
    categoryId: 'cat-coffee',
    price: createMoney(8500), // ฿85.00
    costPrice: createMoney(2500), // ฿25.00
    taxRateBps: 700, // 7% VAT
    currentStock: 95,
    reorderPoint: 20,
    unitOfMeasure: 'cup',
  },
  {
    id: 'prod-coldbrew',
    storeId: 'store-flagship-downtown',
    sku: 'BEV-CLD-03',
    barcode: '890123450003',
    name: 'Nitro Cold Brew (16oz)',
    description: '20-hour steep infused with food-grade nitrogen.',
    categoryId: 'cat-coffee',
    price: createMoney(9500), // ฿95.00
    costPrice: createMoney(2800), // ฿28.00
    taxRateBps: 700, // 7% VAT
    currentStock: 68,
    reorderPoint: 15,
    unitOfMeasure: 'cup',
  },
  {
    id: 'prod-croissant',
    storeId: 'store-flagship-downtown',
    sku: 'BAK-CRS-01',
    barcode: '890123450004',
    name: 'Almond Butter Croissant',
    description: 'Handmade laminated pastry dusted with toasted almonds.',
    categoryId: 'cat-bakery',
    price: createMoney(7500), // ฿75.00
    costPrice: createMoney(2000), // ฿20.00
    taxRateBps: 700, // 7% VAT
    currentStock: 18,
    reorderPoint: 10,
    unitOfMeasure: 'piece',
  },
  {
    id: 'prod-avocadotoast',
    storeId: 'store-flagship-downtown',
    sku: 'BAK-TOA-02',
    barcode: '890123450005',
    name: 'Sourdough Avocado Toast',
    description: 'Rustic sourdough, ripe avocado, sea salt, red pepper flakes.',
    categoryId: 'cat-bakery',
    price: createMoney(13500), // ฿135.00
    costPrice: createMoney(4500), // ฿45.00
    taxRateBps: 700, // 7% VAT
    currentStock: 8,
    reorderPoint: 12,
    unitOfMeasure: 'plate',
  },
  {
    id: 'prod-sparkling',
    storeId: 'store-flagship-downtown',
    sku: 'BEV-SPK-04',
    barcode: '890123450006',
    name: 'Sparkling Mineral Water (500ml)',
    description: 'Naturally carbonated spring water from the Alps.',
    categoryId: 'cat-beverages',
    price: createMoney(4000), // ฿40.00
    costPrice: createMoney(1000), // ฿10.00
    taxRateBps: 700, // 7% VAT
    currentStock: 54,
    reorderPoint: 20,
    unitOfMeasure: 'bottle',
  },
  {
    id: 'prod-beans-ethiopia',
    storeId: 'store-flagship-downtown',
    sku: 'RET-BEA-01',
    barcode: '890123450007',
    name: 'Yirgacheffe Whole Beans (250g)',
    description: 'Tasting notes of bergamot, peach blossom, and jasmine.',
    categoryId: 'cat-beans',
    price: createMoney(45000), // ฿450.00
    costPrice: createMoney(18000), // ฿180.00
    taxRateBps: 0, // Tax exempt
    currentStock: 32,
    reorderPoint: 10,
    unitOfMeasure: 'bag',
  },
  {
    id: 'prod-tumbler',
    storeId: 'store-flagship-downtown',
    sku: 'RET-TMB-02',
    barcode: '890123450008',
    name: 'PRODX Matte Ceramic Tumbler',
    description: 'Double-wall vacuum insulated 16oz travel mug.',
    categoryId: 'cat-retail',
    price: createMoney(75000), // ฿750.00
    costPrice: createMoney(30000), // ฿300.00
    taxRateBps: 700, // 7% VAT
    currentStock: 14,
    reorderPoint: 5,
    unitOfMeasure: 'unit',
  },
];

// In-memory persistent stores for this session
class MockPosState {
  products: Product[] = [...SEED_PRODUCTS];
  categories: Category[] = [...SEED_CATEGORIES];
  inventoryLedger: InventoryLedgerEntry[] = [];
  orders: Order[] = [];
  shifts: Shift[] = [];
  auditLogs: AuditLogEntry[] = [];
  timeclockRecords: TimeclockRecord[] = [];
  idempotencyCache: Map<string, CheckoutResponse> = new Map();
  simulatedLatencyMs = 120;
  isSimulatedOffline = false;

  constructor() {
    this.seedInitialShift();
    this.seedInitialOrders();
    console.info(`${LOG_PREFIX} Initialized in-memory mock repository.`);
    this.loadFromIndexedDB();
  }

  async loadFromIndexedDB() {
    try {
      const cachedProds = await getCachedProducts();
      if (cachedProds && cachedProds.length > 0) {
        this.products = cachedProds;
        console.info('[IndexedDB] Loaded products from cache:', cachedProds.length);
      } else {
        await saveProducts(this.products);
      }

      const cachedCats = await getCachedCategories();
      if (cachedCats && cachedCats.length > 0) {
        this.categories = cachedCats;
        console.info('[IndexedDB] Loaded categories from cache:', cachedCats.length);
      } else {
        await saveCategories(this.categories);
      }

      const cachedOrds = await getCachedOrders();
      if (cachedOrds && cachedOrds.length > 0) {
        this.orders = cachedOrds;
        console.info('[IndexedDB] Loaded orders from cache:', cachedOrds.length);
      } else {
        await saveOrders(this.orders);
      }
    } catch (e) {
      console.warn('[IndexedDB] Constructor fallback warning:', e);
    }
  }

  private seedInitialShift() {
    const openingFloat = createMoney(500000); // ฿5,000.00
    const initialShift: Shift = {
      id: 'shf-20260903-01',
      storeId: 'store-flagship-downtown',
      registerId: 'REG-01',
      cashierId: SEED_USERS[0].id,
      cashierName: SEED_USERS[0].name,
      openedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
      status: 'open',
      openingFloat,
      movements: [
        {
          id: 'mov-open-01',
          shiftId: 'shf-20260903-01',
          type: 'opening_float',
          amount: openingFloat,
          reason: 'Shift opening cash float',
          performedByUserId: SEED_USERS[0].id,
          timestamp: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
        },
      ],
      totalCashSales: createMoney(450000), // ฿4,500.00
      totalCashRefunds: ZERO_USD,
      totalPaidIn: ZERO_USD,
      totalPaidOut: ZERO_USD,
      expectedCashInDrawer: createMoney(950000), // ฿9,500.00
    };
    this.shifts.push(initialShift);
  }

  private seedInitialOrders() {
    // Seed diverse completed orders spanning multiple days for dashboard metrics and reports
    const order1: Order = {
      id: 'ord-hist-001',
      orderNumber: 'ORD-0904-0001',
      idempotencyKey: 'idemp-seed-001',
      storeId: 'store-flagship-downtown',
      registerId: 'REG-01',
      cashierId: SEED_USERS[0].id,
      cashierName: SEED_USERS[0].name,
      customer: {
        id: 'cust-01',
        name: 'Elena Rostova',
        phone: '+66 81 234 5671',
        email: 'elena.r@example.com',
        loyaltyTier: 'VIP',
        loyaltyPoints: 420,
      },
      items: [
        {
          lineId: 'line-01',
          product: SEED_PRODUCTS[1], // Latte
          quantity: 2,
          unitPrice: SEED_PRODUCTS[1].price,
          discountBps: 0,
          lineSubtotal: createMoney(1100),
          lineTax: createMoney(91),
          lineTotal: createMoney(1191),
        },
        {
          lineId: 'line-02',
          product: SEED_PRODUCTS[3], // Croissant
          quantity: 1,
          unitPrice: SEED_PRODUCTS[3].price,
          discountBps: 0,
          lineSubtotal: createMoney(475),
          lineTax: createMoney(39),
          lineTotal: createMoney(514),
        },
      ],
      totals: {
        grossSubtotal: createMoney(1575),
        itemDiscounts: ZERO_USD,
        orderDiscount: ZERO_USD,
        netSubtotal: createMoney(1575),
        totalTax: createMoney(130),
        grandTotal: createMoney(1705),
        totalItemsCount: 3,
      },
      payments: [
        {
          id: 'pay-001',
          method: 'card',
          amount: createMoney(1705),
          authCode: 'AUTH-948102',
          cardLastFour: '4242',
          terminalReference: 'TRM-VERIFONE-01',
          timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        },
      ],
      status: 'server_confirmed',
      serverCommittedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    };

    // Order 2: Today (Cash sale)
    const order2: Order = {
      id: 'ord-hist-002',
      orderNumber: 'ORD-0904-0002',
      idempotencyKey: 'idemp-seed-002',
      storeId: 'store-flagship-downtown',
      registerId: 'REG-01',
      cashierId: SEED_USERS[2].id,
      cashierName: SEED_USERS[2].name,
      customer: {
        id: 'cust-02',
        name: 'Marcus Chen',
        phone: '+66 89 876 5432',
        email: 'marcus.c@example.com',
        loyaltyTier: 'Gold',
        loyaltyPoints: 260,
      },
      items: [
        {
          lineId: 'line-03',
          product: SEED_PRODUCTS[0], // Espresso
          quantity: 2,
          unitPrice: SEED_PRODUCTS[0].price,
          discountBps: 0,
          lineSubtotal: createMoney(900),
          lineTax: createMoney(63),
          lineTotal: createMoney(963),
        },
      ],
      totals: {
        grossSubtotal: createMoney(900),
        itemDiscounts: ZERO_USD,
        orderDiscount: ZERO_USD,
        netSubtotal: createMoney(900),
        totalTax: createMoney(63),
        grandTotal: createMoney(963),
        totalItemsCount: 2,
      },
      payments: [
        {
          id: 'pay-002',
          method: 'cash',
          amount: createMoney(963),
          tenderedCash: createMoney(1000),
          changeGiven: createMoney(37),
          timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        },
      ],
      status: 'server_confirmed',
      serverCommittedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    };

    // Order 3: Yesterday
    const order3: Order = {
      id: 'ord-hist-003',
      orderNumber: 'ORD-0903-0015',
      idempotencyKey: 'idemp-seed-003',
      storeId: 'store-flagship-downtown',
      registerId: 'REG-01',
      cashierId: SEED_USERS[1].id,
      cashierName: SEED_USERS[1].name,
      items: [
        {
          lineId: 'line-04',
          product: SEED_PRODUCTS[2], // Cappuccino
          quantity: 3,
          unitPrice: SEED_PRODUCTS[2].price,
          discountBps: 0,
          lineSubtotal: createMoney(1500),
          lineTax: createMoney(105),
          lineTotal: createMoney(1605),
        },
      ],
      totals: {
        grossSubtotal: createMoney(1500),
        itemDiscounts: ZERO_USD,
        orderDiscount: ZERO_USD,
        netSubtotal: createMoney(1500),
        totalTax: createMoney(105),
        grandTotal: createMoney(1605),
        totalItemsCount: 3,
      },
      payments: [
        {
          id: 'pay-003',
          method: 'qr_digital',
          amount: createMoney(1605),
          authCode: 'PROMPT-883190',
          timestamp: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
        },
      ],
      status: 'server_confirmed',
      serverCommittedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
    };

    // Order 4: 4 days ago
    const order4: Order = {
      id: 'ord-hist-004',
      orderNumber: 'ORD-0831-0042',
      idempotencyKey: 'idemp-seed-004',
      storeId: 'store-flagship-downtown',
      registerId: 'REG-01',
      cashierId: SEED_USERS[0].id,
      cashierName: SEED_USERS[0].name,
      items: [
        {
          lineId: 'line-05',
          product: SEED_PRODUCTS[1],
          quantity: 4,
          unitPrice: SEED_PRODUCTS[1].price,
          discountBps: 0,
          lineSubtotal: createMoney(2200),
          lineTax: createMoney(154),
          lineTotal: createMoney(2354),
        },
      ],
      totals: {
        grossSubtotal: createMoney(2200),
        itemDiscounts: ZERO_USD,
        orderDiscount: ZERO_USD,
        netSubtotal: createMoney(2200),
        totalTax: createMoney(154),
        grandTotal: createMoney(2354),
        totalItemsCount: 4,
      },
      payments: [
        {
          id: 'pay-004',
          method: 'card',
          amount: createMoney(2354),
          authCode: 'AUTH-119283',
          cardLastFour: '1849',
          timestamp: new Date(Date.now() - 96 * 3600 * 1000).toISOString(),
        },
      ],
      status: 'server_confirmed',
      serverCommittedAt: new Date(Date.now() - 96 * 3600 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 96 * 3600 * 1000).toISOString(),
    };

    // Order 5: 12 days ago
    const order5: Order = {
      id: 'ord-hist-005',
      orderNumber: 'ORD-0823-0089',
      idempotencyKey: 'idemp-seed-005',
      storeId: 'store-flagship-downtown',
      registerId: 'REG-01',
      cashierId: SEED_USERS[0].id,
      cashierName: SEED_USERS[0].name,
      items: [
        {
          lineId: 'line-06',
          product: SEED_PRODUCTS[0],
          quantity: 5,
          unitPrice: SEED_PRODUCTS[0].price,
          discountBps: 0,
          lineSubtotal: createMoney(2250),
          lineTax: createMoney(158),
          lineTotal: createMoney(2408),
        },
      ],
      totals: {
        grossSubtotal: createMoney(2250),
        itemDiscounts: ZERO_USD,
        orderDiscount: ZERO_USD,
        netSubtotal: createMoney(2250),
        totalTax: createMoney(158),
        grandTotal: createMoney(2408),
        totalItemsCount: 5,
      },
      payments: [
        {
          id: 'pay-005',
          method: 'cash',
          amount: createMoney(2408),
          tenderedCash: createMoney(2500),
          changeGiven: createMoney(92),
          timestamp: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
        },
      ],
      status: 'server_confirmed',
      serverCommittedAt: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
      createdAt: new Date(Date.now() - 12 * 24 * 3600 * 1000).toISOString(),
    };

    this.orders.push(order1, order2, order3, order4, order5);
  }

  getSimulatedLatency(): number {
    return this.simulatedLatencyMs;
  }

  setSimulatedLatency(ms: number): void {
    this.simulatedLatencyMs = Math.max(0, ms);
  }

  async resetAllData(): Promise<void> {
    this.products = JSON.parse(JSON.stringify(SEED_PRODUCTS));
    this.categories = JSON.parse(JSON.stringify(SEED_CATEGORIES));
    this.inventoryLedger = [];
    this.orders = [];
    this.shifts = [];
    this.auditLogs = [];
    this.idempotencyCache.clear();
    this.seedInitialShift();
    this.seedInitialOrders();
    try {
      await clearAllCachedData();
      await saveProducts(this.products);
      await saveCategories(this.categories);
      await saveOrders(this.orders);
    } catch (e) {
      console.warn('[IndexedDB] Reset sync warning:', e);
    }
  }
}

export const mockState = new MockPosState();

async function delay(ms = mockState.simulatedLatencyMs): Promise<void> {
  if (ms <= 0) return;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Mock Auth API
// ---------------------------------------------------------------------------
export class MockAuthApi implements IAuthApi {
  async login(req: LoginRequest): Promise<SessionContext> {
    await delay();
    console.info(`${LOG_PREFIX} Login attempt:`, { org: req.organizationSlug, store: req.storeCode });

    const store = SEED_STORES.find((s) => s.code.toLowerCase() === req.storeCode.toLowerCase()) || SEED_STORES[0];
    const staffList = typeof window !== 'undefined' ? getStoredStaffDirectory() : DEFAULT_STAFF_DIRECTORY;
    const staffPins = typeof window !== 'undefined' ? getStoredStaffPins() : {};
    const staffPasswords = typeof window !== 'undefined' ? getStoredStaffPasswords() : {};
    const rolePerms = typeof window !== 'undefined' ? getStoredRolePermissions() : ROLE_PERMISSIONS;

    const term = (req.emailOrPin || '').trim();
    const passOrPin = (req.passwordOrPin || '').trim();
    
    // Find user by email or pin match, or construct Guest user
    let user: User;
    if (term.toLowerCase() === 'guest' || term === 'GUEST-POS') {
      user = {
        id: 'usr-guest',
        name: 'Guest Staff',
        email: 'guest@prodx.io',
        role: 'cashier',
        employeeCode: 'GUEST-POS',
        permissions: ['pos:checkout', 'inventory:read', 'customers:read'],
      };
    } else {
      // 1. Match by email
      let matched = staffList.find((u) => u.email.toLowerCase() === term.toLowerCase());

      // 2. Match by employeeCode
      if (!matched) {
        matched = staffList.find((u) => u.employeeCode.toLowerCase() === term.toLowerCase());
      }

      // 3. Match by ID
      if (!matched) {
        matched = staffList.find((u) => u.id === term);
      }

      // 4. Match by PIN if term is a 4-digit PIN
      if (!matched) {
        // Check stored pins
        const userIdForPin = Object.keys(staffPins).find((uid) => staffPins[uid] === term);
        if (userIdForPin) {
          matched = staffList.find((u) => u.id === userIdForPin);
        }
      }

      // 5. Fallback matching for default role PINs
      if (!matched) {
        if (term === '1234') matched = staffList.find((u) => u.role === 'admin');
        else if (term === '5678') matched = staffList.find((u) => u.role === 'manager');
        else if (term === '0000' || term === '1111') matched = staffList.find((u) => u.role === 'cashier');
      }

      // 6. Fallback if passOrPin is the PIN matching the user
      if (!matched && passOrPin) {
        const userIdForPin = Object.keys(staffPins).find((uid) => staffPins[uid] === passOrPin);
        if (userIdForPin) {
          matched = staffList.find((u) => u.id === userIdForPin);
        }
      }

      // Validate credentials if authenticating via password
      if (matched && passOrPin && !term.match(/^\d{4}$/)) {
        const correctPassword = staffPasswords[matched.id] || 'password123';
        const correctPin = staffPins[matched.id];
        const isValid = passOrPin === correctPassword || (correctPin && passOrPin === correctPin) || passOrPin === 'password123';
        if (!isValid) {
          throw new Error('Invalid email or password. Please verify your credentials or use "Manage / Reset Password".');
        }
      }

      user = matched || staffList[0] || SEED_USERS[0];
    }

    // Ensure permissions are synchronized with current role permissions matrix
    const currentPermissions = rolePerms[user.role] || user.permissions || ROLE_PERMISSIONS[user.role];
    const resolvedUser: User = {
      ...user,
      permissions: currentPermissions,
    };

    const session: SessionContext = {
      organization: SEED_ORG,
      currentStore: store,
      registerId: req.registerId || 'REG-01',
      currentUser: resolvedUser,
      token: `mock-jwt-${resolvedUser.id}-${Date.now()}`,
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    };

    // Log audit event
    mockState.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      storeId: store.id,
      registerId: session.registerId,
      userId: resolvedUser.id,
      userName: resolvedUser.name,
      action: 'user_login',
      severity: 'info',
      details: { role: resolvedUser.role, employeeCode: resolvedUser.employeeCode },
      timestamp: new Date().toISOString(),
    });

    return session;
  }

  async logout(): Promise<void> {
    await delay(50);
    console.info(`${LOG_PREFIX} User logged out`);
  }

  async verifySession(token: string): Promise<SessionContext | null> {
    await delay(30);
    if (!token) return null;

    const staffList = typeof window !== 'undefined' ? getStoredStaffDirectory() : DEFAULT_STAFF_DIRECTORY;
    const rolePerms = typeof window !== 'undefined' ? getStoredRolePermissions() : ROLE_PERMISSIONS;

    // Extract user id from token if possible (e.g. mock-jwt-usr-admin-alex-123456789)
    let foundUser: User | undefined;
    if (token.startsWith('mock-jwt-')) {
      const parts = token.split('-');
      // token format: mock-jwt-{id}-{timestamp}
      if (parts.length >= 4) {
        const potentialId = parts.slice(2, parts.length - 1).join('-');
        foundUser = staffList.find((u) => u.id === potentialId);
      }
    }

    const effectiveUser = foundUser || staffList[0] || SEED_USERS[0];
    const currentPermissions = rolePerms[effectiveUser.role] || effectiveUser.permissions || ROLE_PERMISSIONS[effectiveUser.role];

    return {
      organization: SEED_ORG,
      currentStore: SEED_STORES[0],
      registerId: 'REG-01',
      currentUser: {
        ...effectiveUser,
        permissions: currentPermissions,
      },
      token,
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    };
  }

  async getStores(_token: string, _orgSlug: string): Promise<readonly Store[]> {
    await delay(40);
    return SEED_STORES;
  }
}

// ---------------------------------------------------------------------------
// Mock Catalog API
// ---------------------------------------------------------------------------
export class MockCatalogApi implements ICatalogApi {
  async getCategories(_storeId: string): Promise<readonly Category[]> {
    await delay(30);
    return mockState.categories;
  }

  async getProducts(storeId: string, categoryId?: string, search?: string): Promise<readonly Product[]> {
    await delay(50);
    let list = mockState.products.filter((p) => p.storeId === storeId || !p.storeId);

    if (categoryId && categoryId !== 'cat-all') {
      list = list.filter((p) => p.categoryId === categoryId);
    }

    if (search && search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.includes(q)
      );
    }

    return list;
  }

  async getProductByBarcode(storeId: string, barcode: string): Promise<Product | null> {
    await delay(40);
    const p = mockState.products.find(
      (item) => (item.storeId === storeId || !item.storeId) && item.barcode === barcode.trim()
    );
    return p || null;
  }

  async getInventoryLedger(storeId: string, productId?: string): Promise<readonly InventoryLedgerEntry[]> {
    await delay(60);
    let list = mockState.inventoryLedger.filter((e) => e.storeId === storeId);
    if (productId) {
      list = list.filter((e) => e.productId === productId);
    }
    return list;
  }

  async adjustStock(
    storeId: string,
    productId: string,
    quantityDelta: number,
    reason: StockMovementReason,
    userId: string,
    notes?: string
  ): Promise<InventoryLedgerEntry> {
    await delay(80);
    const prodIdx = mockState.products.findIndex((p) => p.id === productId);
    if (prodIdx === -1) {
      throw new Error(`[Inventory] Product with ID ${productId} not found.`);
    }

    const current = mockState.products[prodIdx].currentStock;
    const resultingStock = Math.max(0, current + quantityDelta);

    // Update product snapshot
    mockState.products[prodIdx] = {
      ...mockState.products[prodIdx],
      currentStock: resultingStock,
    };

    saveProducts(mockState.products);

    const entry: InventoryLedgerEntry = {
      id: `ledg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      storeId,
      productId,
      quantityDelta,
      resultingStock,
      reason,
      referenceId: `ADJ-${Date.now()}`,
      performedByUserId: userId,
      notes,
      timestamp: new Date().toISOString(),
    };

    mockState.inventoryLedger.unshift(entry);
    return entry;
  }

  async bulkAdjustStock(
    storeId: string,
    productIds: readonly string[],
    quantityDelta: number,
    reason: StockMovementReason,
    userId: string,
    notes?: string
  ): Promise<readonly InventoryLedgerEntry[]> {
    await delay(120);
    const newEntries: InventoryLedgerEntry[] = [];
    const timestamp = new Date().toISOString();
    const batchRef = `BULK-ADJ-${Date.now()}`;

    for (const productId of productIds) {
      const prodIdx = mockState.products.findIndex((p) => p.id === productId);
      if (prodIdx !== -1) {
        const current = mockState.products[prodIdx].currentStock;
        const resultingStock = Math.max(0, current + quantityDelta);

        mockState.products[prodIdx] = {
          ...mockState.products[prodIdx],
          currentStock: resultingStock,
        };

        const entry: InventoryLedgerEntry = {
          id: `ledg-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          storeId,
          productId,
          quantityDelta,
          resultingStock,
          reason,
          referenceId: batchRef,
          performedByUserId: userId,
          notes: notes ? `${notes} (Bulk)` : 'Bulk Stock Adjustment',
          timestamp,
        };

        mockState.inventoryLedger.unshift(entry);
        newEntries.push(entry);
      }
    }

    saveProducts(mockState.products);

    return newEntries;
  }

  async bulkUpdatePricing(
    storeId: string,
    productIds: readonly string[],
    priceChangeType: 'set_amount' | 'percent_markup' | 'percent_discount',
    value: number,
    userId: string
  ): Promise<readonly Product[]> {
    await delay(120);
    const updatedProducts: Product[] = [];

    for (const productId of productIds) {
      const prodIdx = mockState.products.findIndex((p) => p.id === productId);
      if (prodIdx !== -1) {
        const prod = mockState.products[prodIdx];
        let newAmountInCents = prod.price.amountInCents;

        if (priceChangeType === 'set_amount') {
          newAmountInCents = Math.round(value * 100);
        } else if (priceChangeType === 'percent_markup') {
          newAmountInCents = Math.round(prod.price.amountInCents * (1 + value / 100));
        } else if (priceChangeType === 'percent_discount') {
          newAmountInCents = Math.round(prod.price.amountInCents * (1 - value / 100));
        }

        const newPrice = createMoney(Math.max(0, newAmountInCents), prod.price.currency);
        const updatedProd: Product = {
          ...prod,
          price: newPrice,
        };

        mockState.products[prodIdx] = updatedProd;
        updatedProducts.push(updatedProd);
      }
    }

    saveProducts(mockState.products);

    return updatedProducts;
  }

  async batchPriceAdjustment(
    params: BatchPriceAdjustmentParams
  ): Promise<BatchPriceAdjustmentResult> {
    await delay(120);
    const {
      storeId: _storeId,
      productIds,
      direction,
      percentage,
      roundingStrategy = 'exact_cents',
      reasonNotes: _reasonNotes,
      userId: _userId,
      supervisorName: _supervisorName,
    } = params;

    const batchReference = `PRC-ADJ-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const timestamp = new Date().toISOString();
    const items: BatchPriceAdjustmentItemResult[] = [];
    const updatedProducts: Product[] = [];

    let previousTotalRetailValueCents = 0;
    let newTotalRetailValueCents = 0;

    const factor = direction === 'increase' ? 1 + percentage / 100 : 1 - percentage / 100;

    for (const productId of productIds) {
      const prodIdx = mockState.products.findIndex((p) => p.id === productId);
      if (prodIdx === -1) continue;

      const prod = mockState.products[prodIdx];
      const oldPriceCents = prod.price.amountInCents;
      previousTotalRetailValueCents += oldPriceCents;

      let calculatedCents = Math.round(oldPriceCents * factor);

      if (roundingStrategy === 'round_whole') {
        calculatedCents = Math.round(calculatedCents / 100) * 100;
      } else if (roundingStrategy === 'charm_99') {
        calculatedCents = Math.max(99, Math.floor(calculatedCents / 100) * 100 + 99);
      } else if (roundingStrategy === 'charm_95') {
        calculatedCents = Math.max(95, Math.floor(calculatedCents / 100) * 100 + 95);
      }

      const newPriceCents = Math.max(0, calculatedCents);
      newTotalRetailValueCents += newPriceCents;

      const deltaCents = newPriceCents - oldPriceCents;
      const percentageEffective =
        oldPriceCents > 0 ? ((newPriceCents - oldPriceCents) / oldPriceCents) * 100 : 0;

      const itemResult: BatchPriceAdjustmentItemResult = {
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        oldPriceCents,
        newPriceCents,
        deltaCents,
        percentageEffective,
      };
      items.push(itemResult);

      const updatedProd: Product = {
        ...prod,
        price: createMoney(newPriceCents, prod.price.currency),
      };

      mockState.products[prodIdx] = updatedProd;
      updatedProducts.push(updatedProd);
    }

    saveProducts(mockState.products);

    return {
      batchReference,
      updatedCount: items.length,
      previousTotalRetailValueCents,
      newTotalRetailValueCents,
      deltaRetailValueCents: newTotalRetailValueCents - previousTotalRetailValueCents,
      items,
      updatedProducts,
      timestamp,
    };
  }

  async bulkImportProducts(
    storeId: string,
    items: readonly BulkImportItem[],
    mode: BulkImportMode,
    userId: string,
    notes?: string
  ): Promise<BulkImportResult> {
    await delay(180);
    const batchReference = `IMP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const timestamp = new Date().toISOString();
    const createdProducts: Product[] = [];
    const updatedProducts: Product[] = [];
    const newLedgerEntries: InventoryLedgerEntry[] = [];
    const errors: Array<{ sku: string; rowNumber?: number; reason: string }> = [];

    const store = SEED_STORES.find((s) => s.id === storeId) || SEED_STORES[0];
    const currency = store.currency || 'THB';

    let rowIdx = 1;
    for (const item of items) {
      rowIdx++;
      if (!item.sku || !item.sku.trim()) {
        errors.push({
          sku: item.sku || `Row #${rowIdx}`,
          rowNumber: rowIdx,
          reason: 'Missing mandatory SKU identifier.',
        });
        continue;
      }

      const cleanSku = item.sku.trim();
      const existingIdx = mockState.products.findIndex(
        (p) =>
          (p.storeId === storeId || !p.storeId) &&
          (p.sku.toLowerCase() === cleanSku.toLowerCase() || (item.barcode && p.barcode === item.barcode.trim()))
      );

      if (existingIdx !== -1) {
        // --- Existing Product Update ---
        const existing = mockState.products[existingIdx];
        let newStock = existing.currentStock;
        let delta = 0;
        let ledgerReason: StockMovementReason = 'audit_count_adjustment';

        if (mode === 'stock_override') {
          if (item.currentStock !== undefined && !isNaN(item.currentStock)) {
            newStock = Math.max(0, item.currentStock);
            delta = newStock - existing.currentStock;
            ledgerReason = 'audit_count_adjustment';
          }
        } else if (mode === 'stock_replenish') {
          const addQty = item.quantityDelta !== undefined ? item.quantityDelta : (item.currentStock !== undefined ? item.currentStock : 0);
          if (!isNaN(addQty) && addQty !== 0) {
            delta = addQty;
            newStock = Math.max(0, existing.currentStock + delta);
            ledgerReason = delta > 0 ? 'purchase_received' : 'audit_count_adjustment';
          }
        } else {
          // Upsert or Update Only
          if (item.quantityDelta !== undefined && !isNaN(item.quantityDelta)) {
            delta = item.quantityDelta;
            newStock = Math.max(0, existing.currentStock + delta);
            ledgerReason = delta > 0 ? 'purchase_received' : 'audit_count_adjustment';
          } else if (item.currentStock !== undefined && !isNaN(item.currentStock)) {
            delta = item.currentStock - existing.currentStock;
            newStock = Math.max(0, item.currentStock);
            ledgerReason = 'audit_count_adjustment';
          }
        }

        // Match category
        let finalCategoryId = existing.categoryId;
        if (item.categoryId) {
          finalCategoryId = item.categoryId;
        } else if (item.categoryName) {
          const matchedCat = mockState.categories.find(
            (c) => c.name.toLowerCase() === item.categoryName!.trim().toLowerCase() || c.id === item.categoryName
          );
          if (matchedCat) {
            finalCategoryId = matchedCat.id;
          }
        }

        const updated: Product = {
          ...existing,
          name: item.name && item.name.trim() ? item.name.trim() : existing.name,
          barcode: item.barcode && item.barcode.trim() ? item.barcode.trim() : existing.barcode,
          description: item.description !== undefined ? item.description : existing.description,
          categoryId: finalCategoryId,
          price:
            item.priceAmountInCents !== undefined && !isNaN(item.priceAmountInCents)
              ? createMoney(Math.max(0, item.priceAmountInCents), currency)
              : existing.price,
          costPrice:
            item.costPriceAmountInCents !== undefined && !isNaN(item.costPriceAmountInCents)
              ? createMoney(Math.max(0, item.costPriceAmountInCents), currency)
              : existing.costPrice,
          taxRateBps: item.taxRateBps !== undefined && !isNaN(item.taxRateBps) ? item.taxRateBps : existing.taxRateBps,
          reorderPoint: item.reorderPoint !== undefined && !isNaN(item.reorderPoint) ? item.reorderPoint : existing.reorderPoint,
          unitOfMeasure: item.unitOfMeasure?.trim() || existing.unitOfMeasure,
          currentStock: newStock,
          isAgeRestricted: item.isAgeRestricted !== undefined ? item.isAgeRestricted : existing.isAgeRestricted,
          imageUrl: item.imageUrl || existing.imageUrl,
        };

        mockState.products[existingIdx] = updated;
        updatedProducts.push(updated);

        // Record stock ledger entry if quantity changed
        if (delta !== 0) {
          const entry: InventoryLedgerEntry = {
            id: `ledg-imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            storeId,
            productId: updated.id,
            quantityDelta: delta,
            resultingStock: newStock,
            reason: ledgerReason,
            referenceId: batchReference,
            performedByUserId: userId,
            notes: notes ? `${notes} (Bulk Import: ${mode})` : `Bulk Inventory Import (${mode})`,
            timestamp,
          };
          mockState.inventoryLedger.unshift(entry);
          newLedgerEntries.push(entry);
        }
      } else {
        // --- Product Does NOT Exist ---
        if (mode === 'update_only') {
          errors.push({
            sku: cleanSku,
            rowNumber: rowIdx,
            reason: `Product with SKU "${cleanSku}" not found in catalog (Update Only mode).`,
          });
          continue;
        }

        // Match or determine category
        let finalCategoryId = mockState.categories[0]?.id || 'cat-retail';
        if (item.categoryId && mockState.categories.some((c) => c.id === item.categoryId)) {
          finalCategoryId = item.categoryId;
        } else if (item.categoryName) {
          const matchedCat = mockState.categories.find(
            (c) => c.name.toLowerCase() === item.categoryName!.trim().toLowerCase() || c.id === item.categoryName
          );
          if (matchedCat) {
            finalCategoryId = matchedCat.id;
          } else {
            // Auto-create category if new
            const newCatId = `cat-${item.categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
            const newCat: Category = {
              id: newCatId,
              name: item.categoryName.trim(),
              slug: item.categoryName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
            };
            mockState.categories.push(newCat);
            saveCategories(mockState.categories);
            finalCategoryId = newCatId;
          }
        }

        const initialStock = Math.max(0, item.currentStock ?? item.quantityDelta ?? 0);
        const priceCents = item.priceAmountInCents ?? 1000;
        const costPriceCents = item.costPriceAmountInCents ?? Math.round(priceCents * 0.4);

        const newProd: Product = {
          id: `prod-${cleanSku.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`,
          storeId,
          sku: cleanSku,
          barcode: item.barcode?.trim() || `890${Math.floor(100000000 + Math.random() * 900000000)}`,
          name: item.name?.trim() || `Item ${cleanSku}`,
          description: item.description?.trim() || '',
          categoryId: finalCategoryId,
          price: createMoney(priceCents, currency),
          costPrice: createMoney(costPriceCents, currency),
          taxRateBps: item.taxRateBps ?? 700,
          currentStock: initialStock,
          reorderPoint: item.reorderPoint ?? 10,
          unitOfMeasure: item.unitOfMeasure?.trim() || 'piece',
          isAgeRestricted: Boolean(item.isAgeRestricted),
          imageUrl: item.imageUrl,
        };

        mockState.products.push(newProd);
        createdProducts.push(newProd);

        if (initialStock > 0) {
          const entry: InventoryLedgerEntry = {
            id: `ledg-imp-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            storeId,
            productId: newProd.id,
            quantityDelta: initialStock,
            resultingStock: initialStock,
            reason: 'purchase_received',
            referenceId: batchReference,
            performedByUserId: userId,
            notes: notes ? `${notes} (Initial Stock from Bulk Import)` : `Initial Stock Setup from Bulk Import (${mode})`,
            timestamp,
          };
          mockState.inventoryLedger.unshift(entry);
          newLedgerEntries.push(entry);
        }
      }
    }

    // Persist changes
    saveProducts(mockState.products);

    // Record Audit Log Entry
    mockState.auditLogs.unshift({
      id: `aud-import-${Date.now()}`,
      storeId,
      registerId: 'REG-01',
      userId,
      userName: SEED_USERS.find((u) => u.id === userId)?.name || 'Admin',
      action: 'stock_adjusted',
      severity: 'info',
      details: {
        batchReference,
        mode,
        totalItems: items.length,
        createdCount: createdProducts.length,
        updatedCount: updatedProducts.length,
        skippedErrorsCount: errors.length,
      },
      timestamp,
    });

    return {
      batchReference,
      totalProcessed: items.length,
      createdCount: createdProducts.length,
      updatedCount: updatedProducts.length,
      skippedCount: errors.length,
      createdProducts,
      updatedProducts,
      ledgerEntries: newLedgerEntries,
      errors,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock Order & Checkout API
// ---------------------------------------------------------------------------
export class MockOrderApi implements IOrderApi {
  async createOrder(req: CheckoutRequest): Promise<CheckoutResponse> {
    await delay();

    // Idempotency check: duplicate prevention
    if (mockState.idempotencyCache.has(req.idempotencyKey)) {
      console.warn(`${LOG_PREFIX} Idempotency hit: returning cached order for key: ${req.idempotencyKey}`);
      const cached = mockState.idempotencyCache.get(req.idempotencyKey)!;
      return {
        ...cached,
        idempotencyCached: true,
      };
    }

    const now = new Date().toISOString();
    const orderSeq = (mockState.orders.length + 1).toString().padStart(4, '0');
    const orderNumber = `ORD-${new Date().toISOString().slice(5, 10).replace('-', '')}-${orderSeq}`;

    // If offline submission is flagged, do NOT commit as server_confirmed!
    const isOffline = req.isOfflineSubmission || mockState.isSimulatedOffline;

    const cashierUser = req.cashierId === 'usr-guest'
      ? { name: 'Guest Staff' }
      : (SEED_USERS.find((u) => u.id === req.cashierId) || { name: 'Alex Vance' });

    const newOrder: Order = {
      id: `ord-${Date.now()}`,
      orderNumber,
      idempotencyKey: req.idempotencyKey,
      storeId: req.storeId,
      registerId: req.registerId,
      cashierId: req.cashierId,
      cashierName: cashierUser.name,
      customer: req.customer ? {
        id: req.customer.id,
        name: req.customer.name,
        phone: req.customer.phone,
        email: req.customer.email,
        loyaltyTier: 'Gold',
        loyaltyPoints: 150,
      } : undefined,
      items: req.items,
      totals: req.totals,
      payments: req.payments,
      status: isOffline ? 'pending_sync_offline' : 'server_confirmed',
      serverCommittedAt: isOffline ? undefined : now,
      createdAt: now,
      notes: req.notes,
    };

    // Append to audit log
    mockState.auditLogs.unshift({
      id: `aud-checkout-${Date.now()}`,
      storeId: req.storeId,
      registerId: req.registerId,
      userId: req.cashierId,
      userName: cashierUser.name,
      action: isOffline ? 'order_checkout_queued_offline' : 'order_checkout_committed',
      severity: 'info',
      details: {
        orderNumber: newOrder.orderNumber,
        grandTotal: req.totals.grandTotal.amountInCents,
        itemsCount: req.totals.totalItemsCount,
        paymentMethods: req.payments.map((p) => p.method),
      },
      timestamp: now,
    });

    if (!isOffline) {
      // Authoritative server state updates
      mockState.orders.unshift(newOrder);

      // Inventory deductions via ledger entries
      for (const item of req.items) {
        const prodIdx = mockState.products.findIndex((p) => p.id === item.product.id);
        if (prodIdx !== -1) {
          const currentStock = mockState.products[prodIdx].currentStock;
          const newStock = Math.max(0, currentStock - item.quantity);
          mockState.products[prodIdx] = {
            ...mockState.products[prodIdx],
            currentStock: newStock,
          };

          mockState.inventoryLedger.unshift({
            id: `ledg-sale-${Date.now()}-${item.lineId}`,
            storeId: req.storeId,
            productId: item.product.id,
            quantityDelta: -item.quantity,
            resultingStock: newStock,
            reason: 'sale_deduction',
            referenceId: newOrder.orderNumber,
            performedByUserId: req.cashierId,
            timestamp: now,
          });
        }
      }

      // Record cash movement if cash tender was used
      const cashPayment = req.payments.find((p) => p.method === 'cash');
      if (cashPayment && mockState.shifts.length > 0) {
        const shiftIndex = mockState.shifts.findIndex((s) => s.status === 'open');
        if (shiftIndex !== -1) {
          const activeShift = mockState.shifts[shiftIndex];
          const netCash = cashPayment.tenderedCash && cashPayment.changeGiven
            ? subtractMoney(cashPayment.tenderedCash, cashPayment.changeGiven)
            : cashPayment.amount;

          const updatedMovements = [
            ...activeShift.movements,
            {
              id: `mov-${Date.now()}`,
              shiftId: activeShift.id,
              type: 'cash_sale' as const,
              amount: netCash,
              reason: `Sale ${newOrder.orderNumber}`,
              performedByUserId: req.cashierId,
              timestamp: now,
            },
          ];

          mockState.shifts[shiftIndex] = {
            ...activeShift,
            movements: updatedMovements,
            totalCashSales: addMoney(activeShift.totalCashSales, netCash),
            expectedCashInDrawer: computeExpectedDrawerCash(activeShift.openingFloat, updatedMovements),
          };
        }
      }
    }

    const response: CheckoutResponse = {
      success: true,
      order: newOrder,
      serverConfirmed: !isOffline,
      message: isOffline
        ? 'Transaction queued in local outbox (offline mode). Not yet server-committed.'
        : 'Transaction authorized and committed by authoritative server.',
    };

    if (!isOffline) {
      mockState.idempotencyCache.set(req.idempotencyKey, response);
    }

    saveSingleOrder(newOrder);
    if (!isOffline) {
      saveProducts(mockState.products);
    }

    return response;
  }

  async getOrders(storeId: string, limit = 50): Promise<readonly Order[]> {
    await delay(50);
    return mockState.orders.filter((o) => o.storeId === storeId).slice(0, limit);
  }

  async getOrderById(storeId: string, orderId: string): Promise<Order | null> {
    await delay(30);
    const o = mockState.orders.find((item) => item.storeId === storeId && item.id === orderId);
    return o || null;
  }

  async voidOrder(storeId: string, orderId: string, reason: string, authorizedByUserId: string): Promise<Order> {
    await delay(80);
    const idx = mockState.orders.findIndex((o) => o.storeId === storeId && o.id === orderId);
    if (idx === -1) {
      throw new Error(`Order ${orderId} not found`);
    }

    const order = mockState.orders[idx];
    const updated: Order = {
      ...order,
      status: 'voided',
    };
    mockState.orders[idx] = updated;

    // Record audit event
    mockState.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      storeId,
      registerId: order.registerId,
      userId: authorizedByUserId,
      userName: 'Manager Override',
      action: 'order_voided',
      severity: 'critical',
      details: { orderNumber: order.orderNumber, reason },
      timestamp: new Date().toISOString(),
    });

    return updated;
  }

  async refundOrder(
    storeId: string,
    orderId: string,
    refundAmount: Money,
    reason: string,
    refundMethod: 'cash' | 'card' | 'qr_digital',
    restockItems: boolean,
    authorizedByUserId: string,
    authorizedByName: string,
    itemsToRestock?: readonly { productId: string; quantity: number }[]
  ): Promise<Order> {
    await delay(100);
    const idx = mockState.orders.findIndex((o) => o.storeId === storeId && o.id === orderId);
    if (idx === -1) {
      throw new Error(`Order ${orderId} not found`);
    }

    const order = mockState.orders[idx];
    const now = new Date().toISOString();
    const isPartialAmount = refundAmount.amountInCents < order.totals.grandTotal.amountInCents;
    const isFullRefund = refundAmount.amountInCents >= order.totals.grandTotal.amountInCents;
    
    const updated: Order = {
      ...order,
      status: isFullRefund ? 'refunded' : 'server_confirmed',
      notes: order.notes
        ? `${order.notes} | [REFUND ${isPartialAmount ? 'PARTIAL' : 'FULL'}] ${reason} (${refundMethod.toUpperCase()}) by ${authorizedByName}`
        : `[REFUND ${isPartialAmount ? 'PARTIAL' : 'FULL'}] ${reason} (${refundMethod.toUpperCase()}) by ${authorizedByName}`,
    };
    mockState.orders[idx] = updated;

    // Restock items in inventory ledger if requested
    if (restockItems) {
      const restockList = itemsToRestock && itemsToRestock.length > 0
        ? itemsToRestock
        : order.items.map((i) => ({ productId: i.product.id, quantity: i.quantity }));

      for (const item of restockList) {
        if (item.quantity <= 0) continue;
        const prodIdx = mockState.products.findIndex((p) => p.id === item.productId);
        if (prodIdx !== -1) {
          const currentStock = mockState.products[prodIdx].currentStock;
          const newStock = currentStock + item.quantity;
          mockState.products[prodIdx] = {
            ...mockState.products[prodIdx],
            currentStock: newStock,
          };

          mockState.inventoryLedger.unshift({
            id: `ledg-refund-${Date.now()}-${item.productId}`,
            storeId,
            productId: item.productId,
            quantityDelta: item.quantity,
            resultingStock: newStock,
            reason: 'refund_restock',
            referenceId: `REF-${order.orderNumber}`,
            performedByUserId: authorizedByUserId,
            notes: `Customer return / refund: ${reason}`,
            timestamp: now,
          });
        }
      }
      saveProducts(mockState.products);
    }

    // Record cash movement if cash refund
    if (refundMethod === 'cash' && mockState.shifts.length > 0) {
      const shiftIndex = mockState.shifts.findIndex((s) => s.status === 'open');
      if (shiftIndex !== -1) {
        const activeShift = mockState.shifts[shiftIndex];
        const updatedMovements = [
          ...activeShift.movements,
          {
            id: `mov-refund-${Date.now()}`,
            shiftId: activeShift.id,
            type: 'cash_refund' as const,
            amount: refundAmount,
            reason: `Refund for Order #${order.orderNumber}: ${reason}`,
            performedByUserId: authorizedByUserId,
            timestamp: now,
          },
        ];

        mockState.shifts[shiftIndex] = {
          ...activeShift,
          movements: updatedMovements,
          totalCashRefunds: addMoney(activeShift.totalCashRefunds, refundAmount),
          expectedCashInDrawer: computeExpectedDrawerCash(activeShift.openingFloat, updatedMovements),
        };
      }
    }

    // Record audit event
    mockState.auditLogs.unshift({
      id: `aud-${Date.now()}`,
      storeId,
      registerId: order.registerId,
      userId: authorizedByUserId,
      userName: authorizedByName,
      action: 'order_refunded' as any,
      severity: 'critical',
      details: {
        orderNumber: order.orderNumber,
        refundAmount: refundAmount.amountInCents,
        reason,
        refundMethod,
        restockItems,
        itemsRestockedCount: itemsToRestock ? itemsToRestock.length : order.items.length,
      },
      timestamp: now,
    });

    saveSingleOrder(updated);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('prodx:inventory-updated', { detail: { orderId, orderNumber: order.orderNumber } }));
      window.dispatchEvent(new CustomEvent('prodx:order-completed'));
    }

    return updated;
  }
}

// ---------------------------------------------------------------------------
// Mock Shift API
// ---------------------------------------------------------------------------
export class MockShiftApi implements IShiftApi {
  async getCurrentShift(storeId: string, registerId: string): Promise<Shift | null> {
    await delay(40);
    const shift = mockState.shifts.find(
      (s) => s.storeId === storeId && s.registerId === registerId && s.status === 'open'
    );
    return shift || null;
  }

  async openShift(storeId: string, registerId: string, openingFloat: Money, cashier: User): Promise<Shift> {
    await delay(80);
    const existingActiveShift = mockState.shifts.find(
      (s) => s.storeId === storeId && s.registerId === registerId && s.status === 'open'
    );
    if (existingActiveShift) {
      throw new Error(`Register ${registerId} already has an active shift (${existingActiveShift.id}). Please close it before opening a new one.`);
    }

    const now = new Date().toISOString();
    const newShift: Shift = {
      id: `shf-${Date.now()}`,
      storeId,
      registerId,
      cashierId: cashier.id,
      cashierName: cashier.name,
      openedAt: now,
      status: 'open',
      openingFloat,
      movements: [
        {
          id: `mov-${Date.now()}`,
          shiftId: `shf-${Date.now()}`,
          type: 'opening_float',
          amount: openingFloat,
          reason: 'Initial opening cash drawer float',
          performedByUserId: cashier.id,
          timestamp: now,
        },
      ],
      totalCashSales: ZERO_USD,
      totalCashRefunds: ZERO_USD,
      totalPaidIn: ZERO_USD,
      totalPaidOut: ZERO_USD,
      expectedCashInDrawer: openingFloat,
    };

    mockState.shifts.unshift(newShift);
    return newShift;
  }

  async closeShift(shiftId: string, actualCountedCash: Money, closingNotes?: string): Promise<Shift> {
    await delay(100);
    const idx = mockState.shifts.findIndex((s) => s.id === shiftId);
    if (idx === -1) throw new Error(`Shift ${shiftId} not found`);

    const shift = mockState.shifts[idx];
    const variance = subtractMoney(actualCountedCash, shift.expectedCashInDrawer);

    const closed: Shift = {
      ...shift,
      status: 'closed',
      closedAt: new Date().toISOString(),
      actualCountedCash,
      variance,
      closingNotes,
    };
    mockState.shifts[idx] = closed;
    return closed;
  }

  async recordCashMovement(
    shiftId: string,
    type: CashMovementType,
    amount: Money,
    reason: string,
    userId: string
  ): Promise<CashMovement> {
    await delay(60);
    const idx = mockState.shifts.findIndex((s) => s.id === shiftId);
    if (idx === -1) throw new Error(`Shift ${shiftId} not found`);

    const shift = mockState.shifts[idx];
    const movement: CashMovement = {
      id: `mov-${Date.now()}`,
      shiftId,
      type,
      amount,
      reason,
      performedByUserId: userId,
      timestamp: new Date().toISOString(),
    };

    const movements = [...shift.movements, movement];
    let totalPaidIn = shift.totalPaidIn;
    let totalPaidOut = shift.totalPaidOut;

    if (type === 'paid_in') {
      totalPaidIn = addMoney(totalPaidIn, amount);
    } else if (type === 'paid_out') {
      totalPaidOut = addMoney(totalPaidOut, amount);
    }

    mockState.shifts[idx] = {
      ...shift,
      movements,
      totalPaidIn,
      totalPaidOut,
      expectedCashInDrawer: computeExpectedDrawerCash(shift.openingFloat, movements),
    };

    return movement;
  }

  async clockIn(pin: string, storeId: string): Promise<TimeclockRecord> {
    await delay(100);
    // Hardcoded PINs for demo: 1234 -> Admin, 5678 -> Manager, 0000 -> Cashier
    const user = SEED_USERS.find(u => {
      if (pin === '1234' && u.role === 'admin') return true;
      if (pin === '5678' && u.role === 'manager') return true;
      if (pin === '0000' && u.role === 'cashier') return true;
      return false;
    });

    if (!user) {
      throw new Error('Invalid PIN');
    }

    // Check if already clocked in
    const existing = mockState.timeclockRecords.find(
      r => r.userId === user.id && r.status === 'clocked_in'
    );
    if (existing) {
      throw new Error(`${user.name} is already clocked in.`);
    }

    const record: TimeclockRecord = {
      id: `tc-${Date.now()}`,
      userId: user.id,
      userName: user.name,
      employeeCode: user.employeeCode,
      status: 'clocked_in',
      clockedInAt: new Date().toISOString(),
    };

    mockState.timeclockRecords.unshift(record);
    return record;
  }

  async clockOut(pin: string, storeId: string): Promise<TimeclockRecord> {
    await delay(100);
    // Hardcoded PINs for demo
    const user = SEED_USERS.find(u => {
      if (pin === '1234' && u.role === 'admin') return true;
      if (pin === '5678' && u.role === 'manager') return true;
      if (pin === '0000' && u.role === 'cashier') return true;
      return false;
    });

    if (!user) {
      throw new Error('Invalid PIN');
    }

    const existingIdx = mockState.timeclockRecords.findIndex(
      r => r.userId === user.id && r.status === 'clocked_in'
    );
    
    if (existingIdx === -1) {
      throw new Error(`${user.name} is not clocked in.`);
    }

    const record = mockState.timeclockRecords[existingIdx];
    const updated: TimeclockRecord = {
      ...record,
      status: 'clocked_out',
      clockedOutAt: new Date().toISOString(),
    };

    mockState.timeclockRecords[existingIdx] = updated;
    return updated;
  }

  async getTimeclockRecords(storeId: string): Promise<TimeclockRecord[]> {
    await delay(50);
    return [...mockState.timeclockRecords];
  }
}

// ---------------------------------------------------------------------------
// Mock Audit API
// ---------------------------------------------------------------------------
export class MockAuditApi implements IAuditApi {
  async recordEvent(
    storeId: string,
    registerId: string,
    userId: string,
    userName: string,
    action: AuditAction,
    severity: AuditSeverity,
    details: Record<string, unknown>
  ): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      storeId,
      registerId,
      userId,
      userName,
      action,
      severity,
      details,
      timestamp: new Date().toISOString(),
    };
    mockState.auditLogs.unshift(entry);
    return entry;
  }

  async getLogs(storeId: string, limit = 50): Promise<readonly AuditLogEntry[]> {
    await delay(30);
    return mockState.auditLogs.filter((l) => l.storeId === storeId).slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Mock Sync API (Offline Outbox synchronizer)
// ---------------------------------------------------------------------------
export class MockSyncApi implements ISyncApi {
  async ping(clientTimestamp = Date.now()): Promise<{ serverTimestamp: string; roundTripLatencyMs: number; status: 'ok' | 'degraded' }> {
    if (mockState.isSimulatedOffline) {
      throw new Error('Cloud database unreachable: Offline mode active');
    }
    const start = performance.now();
    // Base cloud DB RTT overhead + simulated artificial latency + slight natural jitter
    const jitter = Math.floor(Math.random() * 8) - 4;
    const baseWait = Math.max(10, mockState.simulatedLatencyMs + jitter);
    await delay(baseWait);
    const elapsed = Math.max(1, Math.round(performance.now() - start));
    return {
      serverTimestamp: new Date().toISOString(),
      roundTripLatencyMs: elapsed,
      status: elapsed > 800 ? 'degraded' : 'ok',
    };
  }

  async syncOutboxItem(item: OutboxItem): Promise<{ confirmedOrder: Order; syncedAt: string }> {
    if (mockState.isSimulatedOffline) {
      throw new Error('Cloud database unreachable: Offline mode active');
    }
    const syncDelay = mockState.simulatedLatencyMs > 0 ? mockState.simulatedLatencyMs + 50 : 150;
    await delay(syncDelay);
    console.info(`${LOG_PREFIX} Synchronizing outbox item:`, item.idempotencyKey);

    const payload = item.payload as CheckoutRequest;
    const now = new Date().toISOString();

    const confirmedOrder: Order = {
      id: `ord-synced-${Date.now()}`,
      orderNumber: `ORD-${now.slice(5, 10).replace('-', '')}-${(mockState.orders.length + 1).toString().padStart(4, '0')}`,
      idempotencyKey: item.idempotencyKey,
      storeId: payload.storeId,
      registerId: payload.registerId,
      cashierId: payload.cashierId,
      cashierName: 'Alex Vance',
      customer: payload.customer ? {
        id: payload.customer.id,
        name: payload.customer.name,
        phone: payload.customer.phone,
        email: payload.customer.email,
        loyaltyTier: 'Silver',
        loyaltyPoints: 100,
      } : undefined,
      items: payload.items,
      totals: payload.totals,
      payments: payload.payments,
      status: 'server_confirmed',
      serverCommittedAt: now,
      createdAt: item.createdAt,
      offlineOutboxId: item.id,
    };

    mockState.orders.unshift(confirmedOrder);
    return { confirmedOrder, syncedAt: now };
  }
}

// Export singleton API services
export const authApi = new MockAuthApi();
export const catalogApi = new MockCatalogApi();
export const orderApi = new MockOrderApi();
export const shiftApi = new MockShiftApi();
export const auditApi = new MockAuditApi();
export const syncApi = new MockSyncApi();
