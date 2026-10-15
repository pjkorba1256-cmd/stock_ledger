export interface StockQuant {
  id: string;
  productId: string;
  variantId: string | null;
  locationId: string;
  lotId: string | null;
  quantity: string;
  reservedQuantity: string;
  costPricePaise: string | null;
  lastCountDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MoveState = 'DRAFT' | 'CONFIRMED' | 'DONE' | 'CANCELLED';
export type ReferenceType = 'GRN' | 'SALE' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT' | 'SCRAP';

export interface StockMove {
  id: string;
  referenceId: string | null;
  referenceType: ReferenceType | null;
  productId: string;
  variantId: string | null;
  lotId: string | null;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: string;
  unitCostPaise: string | null;
  state: MoveState;
  scheduledDate: string | null;
  doneDate: string | null;
  transferId: string | null;
  performedBy: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface AuditRecord {
  productId: string;
  variantId: string | null;
  locationId: string;
  locationName: string;
  lotId: string | null;
  expectedLedgerQuantity: string;
  actualQuantQuantity: string;
  discrepancy: string;
  isReconciled: boolean;
}

export interface ReconciliationReport {
  status: 'RECONCILED' | 'DISCREPANCY_DETECTED';
  reconciledAt: string;
  totalAuditedItems: number;
  discrepanciesCount: number;
  discrepancies: AuditRecord[];
  auditDetails: AuditRecord[];
}

export interface CreateStockMovePayload {
  referenceType?: ReferenceType;
  productId: string;
  variantId?: string;
  sourceLocationId: string;
  destinationLocationId: string;
  quantity: number;
  unitCostPaise?: number;
  performedBy: string;
  notes?: string;
}

export interface LocationItem {
  id: string;
  warehouseId: string;
  parentLocationId?: string | null;
  name: string;
  code: string;
  type: string;
  barcode?: string | null;
  sortOrder?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface WarehouseItem {
  id: string;
  merchantId: string;
  name: string;
  code: string;
  address?: Record<string, unknown> | null;
  isActive: boolean;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LotItem {
  id: string;
  productId: string;
  name: string;
  vendorId?: string | null;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  reference?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface ExpiringLotItem {
  quantId: string;
  warehouseId: string;
  storeName: string;
  storeCode: string;
  locationId: string;
  locationName: string;
  productId: string;
  lotId: string;
  lotName: string;
  manufacturingDate: string | null;
  expiryDate: string;
  daysUntilExpiry: number;
  onHandQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  unitCostPaise: number;
  stockValuePaise: number;
  status: 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'HEALTHY';
}

export interface ExpiringStockStoreGroup {
  warehouseId: string;
  storeName: string;
  storeCode: string;
  totalLots: number;
  totalUnits: number;
  expiredUnits: number;
  criticalUnits: number;
  warningUnits: number;
  totalValuePaise: number;
  items: ExpiringLotItem[];
}

export interface ExpiringStockReport {
  asOfDate: string;
  horizonDays: number;
  cutoffDate: string;
  totalExpiringLots: number;
  totalExpiringUnits: number;
  totalAtRiskValuePaise: number;
  stores: ExpiringStockStoreGroup[];
  data: ExpiringLotItem[];
}

export interface ReservationItem {
  id: string;
  merchantId: string;
  orderReference: string;
  productId: string;
  variantId?: string | null;
  locationId: string;
  lotId?: string | null;
  quantId?: string | null;
  quantity: string;
  state: 'RESERVED' | 'CONFIRMED' | 'PICKED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransferLineItem {
  productId: string;
  lotId?: string | null;
  quantity: string;
  receivedQuantity?: string | null;
  shortageQuantity?: string | null;
}

export interface TransferItem {
  id: string;
  transferNumber: string;
  type: 'INTERNAL' | 'INBOUND' | 'OUTBOUND';
  warehouseId: string;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  state: 'DRAFT' | 'CONFIRMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
  scheduledDate?: string | null;
  doneDate?: string | null;
  notes?: string | null;
  lines: TransferLineItem[];
  createdAt: string;
}

export interface ScrapItem {
  id: string;
  productId: string;
  lotId?: string | null;
  sourceLocationId: string;
  scrapLocationId: string;
  quantity: string;
  reason: string;
  state: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  requestedBy: string;
  approvedBy?: string | null;
  rejectedBy?: string | null;
  createdAt: string;
}

export interface CountLineItem {
  id: string;
  productId: string;
  lotId?: string | null;
  systemQuantity: string;
  countedQuantity: string;
  varianceQuantity: string;
  notes?: string | null;
}

export interface CountItem {
  id: string;
  countNumber: string;
  warehouseId: string;
  locationId: string;
  countedBy: string;
  state: 'DRAFT' | 'REVIEW' | 'POSTED' | 'CANCELLED';
  notes?: string | null;
  lines?: CountLineItem[];
  createdAt: string;
}

