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
