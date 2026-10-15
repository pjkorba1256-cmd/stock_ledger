import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryApiService } from './services/inventory-api.service';
import {
  CountItem,
  CountLineItem,
  CreateStockMovePayload,
  ExpiringLotItem,
  ExpiringStockReport,
  ExpiringStockStoreGroup,
  LocationItem,
  LotItem,
  Pagination,
  ReconciliationReport,
  ReferenceType,
  ReservationItem,
  ScrapItem,
  StockMove,
  StockQuant,
  TransferItem,
  TransferLineItem,
  WarehouseItem,
} from './models/inventory.models';

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
  category?: string;
}

export const KNOWN_PRODUCTS: CatalogProduct[] = [
  // FreshMart Grocery & Perishable Products
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Fresh Pasteurised Full Cream Milk (1L)',
    sku: 'MILK-FC-1L',
    category: 'Dairy',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Organic A2 Cow Milk (500ml)',
    sku: 'MILK-A2-500M',
    category: 'Dairy',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Whole Wheat Farm Bread (400g)',
    sku: 'BRD-WHT-400G',
    category: 'Bakery',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Country Fresh Brown Eggs (Pack of 6)',
    sku: 'EGG-BRN-6PK',
    category: 'Poultry',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Pasteurised Table Butter (500g)',
    sku: 'BTR-TAB-500G',
    category: 'Dairy',
  },
  // Hardware & Packaged Goods
  {
    id: 'fde0a9c4-24ad-495d-8b2a-fc7e42038e5a',
    name: 'High-Tensile Steel Rods (10mm)',
    sku: 'STL-ROD-10',
    category: 'Hardware',
  },
  {
    id: 'c7287c2a-c0b1-439d-83fd-39a3309588f1',
    name: 'Industrial Cement Bags (50kg)',
    sku: 'CMT-BAG-50',
    category: 'Building',
  },
  {
    id: '002c517d-8539-465a-86d1-a70ce12b29d3',
    name: 'Structural Aluminum Angle (2in)',
    sku: 'ALM-ANG-20',
    category: 'Hardware',
  },
  {
    id: '69edcf40-1e34-4a85-a544-772fe830c4c8',
    name: 'Hardwood Plywood Sheet (18mm)',
    sku: 'PLY-SHT-18',
    category: 'Timber',
  },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class App implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly cdr = inject(ChangeDetectorRef);

  // Active navigation tab (Flagship P03 dashboard defaults to 'expiring-stock')
  activeTab:
    | 'expiring-stock'
    | 'stock-on-hand'
    | 'moves'
    | 'lots'
    | 'reservations'
    | 'transfers'
    | 'scrap'
    | 'counts'
    | 'reconciliation'
    | 'new-move' = 'expiring-stock';

  sidebarCollapsed = false;

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  readonly Math = Math;
  readonly Number = Number;

  // Master product catalog & location mapping
  readonly knownProducts: CatalogProduct[] = KNOWN_PRODUCTS;
  locations: LocationItem[] = [];
  warehouses: WarehouseItem[] = [];
  locationsMap = new Map<string, LocationItem>();
  warehousesMap = new Map<string, WarehouseItem>();

  // Global feedback alerts
  alertMessage: string | null = null;
  alertType: 'success' | 'error' | 'info' = 'info';
  copiedField: string | null = null;
  seedingData = false;

  // ==========================================
  // 1. Expiring Stock Dashboard State (P03 Core)
  // ==========================================
  expiringReport: ExpiringStockReport | null = null;
  loadingExpiring = false;
  horizonDays = 7;
  expiringStoreFilter = '';
  expiringProductFilter = '';
  expiringStatusFilter: '' | 'EXPIRED' | 'CRITICAL' | 'WARNING' | 'HEALTHY' = '';

  // ==========================================
  // 2. Stock On Hand State (P02)
  // ==========================================
  quants: StockQuant[] = [];
  quantsPagination: Pagination = { page: 1, limit: 10, total: 0, totalPages: 0 };
  sohProductFilter = '';
  sohLocationFilter = '';
  loadingSoh = false;

  // ==========================================
  // 3. Movement Ledger State (P02)
  // ==========================================
  moves: StockMove[] = [];
  movesPagination: Pagination = { page: 1, limit: 10, total: 0, totalPages: 0 };
  movesStateFilter = '';
  movesTypeFilter = '';
  movesProductFilter = '';
  loadingMoves = false;

  // ==========================================
  // 4. Lots & FEFO State (P03)
  // ==========================================
  lots: LotItem[] = [];
  loadingLots = false;
  lotsProductFilter = '';

  // ==========================================
  // 5. Reservations State (P03)
  // ==========================================
  reservations: ReservationItem[] = [];
  loadingReservations = false;
  reservationStateFilter = '';

  // ==========================================
  // 6. Transfers State (P03)
  // ==========================================
  transfers: TransferItem[] = [];
  loadingTransfers = false;
  transferWarehouseFilter = '';
  transferStateFilter = '';

  // ==========================================
  // 7. Scrap & Approvals State (P03)
  // ==========================================
  scrapRequests: ScrapItem[] = [];
  loadingScrap = false;
  scrapStateFilter = '';

  // ==========================================
  // 8. Physical Counts State (P03)
  // ==========================================
  counts: CountItem[] = [];
  loadingCounts = false;
  selectedCount: CountItem | null = null;

  // ==========================================
  // 9. Reconciliation State (P02)
  // ==========================================
  reconciliationReport: ReconciliationReport | null = null;
  reconcileProductFilter = '';
  loadingReconciliation = false;

  // ==========================================
  // Workflow Action Modals & Forms State
  // ==========================================
  showReceiveLotModal = false;
  receiveLotForm = {
    productId: '11111111-1111-4111-8111-111111111111',
    lotName: '',
    locationId: '',
    quantity: 100,
    unitCostPaise: 5400,
    manufacturingDate: new Date().toISOString().slice(0, 10),
    expiryDate: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
    performedBy: 'store-clerk-1',
    notes: 'Inward shipment batch',
  };

  showFefoSaleModal = false;
  fefoSaleForm = {
    productId: '11111111-1111-4111-8111-111111111111',
    sourceLocationId: '',
    quantity: 10,
    performedBy: 'pos-cashier-3',
    orderReference: '',
  };

  showReservationModal = false;
  reservationForm = {
    merchantId: 'd2961899-7090-4d21-94ef-81e63aeb646d',
    orderReference: '',
    productId: '11111111-1111-4111-8111-111111111111',
    locationId: '',
    lotId: '',
    quantity: 5,
    timeoutMinutes: 15,
    createdBy: 'freshmart-web-shopper',
  };

  showTransferModal = false;
  transferForm = {
    type: 'INTERNAL',
    warehouseId: '',
    sourceLocationId: '',
    destinationLocationId: '',
    productId: '11111111-1111-4111-8111-111111111111',
    lotId: '',
    quantity: 15,
    notes: 'Inter-branch stock rebalancing',
    createdBy: 'logistics-lead',
  };

  showReceiveTransferModal = false;
  activeTransferForReceipt: TransferItem | null = null;
  receiveTransferForm = {
    receivedBy: 'dest-store-manager',
    lines: [] as Array<{
      productId: string;
      lotId?: string | null;
      dispatchedQuantity: number;
      receivedQuantity: number;
      shortageQuantity: number;
      shortageReason: string;
    }>,
  };

  showScrapModal = false;
  scrapForm = {
    productId: '11111111-1111-4111-8111-111111111111',
    lotId: '',
    sourceLocationId: '',
    quantity: 5,
    reason: 'EXPIRED_LOT',
    requestedBy: 'floor-associate',
  };

  showCountModal = false;
  countForm = {
    warehouseId: '',
    locationId: '',
    countedBy: 'audit-associate-patel',
    notes: 'Cycle count shelf verification',
  };

  showRecordLinesModal = false;
  activeCountForRecord: CountItem | null = null;
  recordLinesForm = {
    lines: [] as Array<{
      productId: string;
      lotId?: string | null;
      systemQuantity: number;
      countedQuantity: number;
      notes: string;
    }>,
  };

  newMove: CreateStockMovePayload = {
    referenceType: 'TRANSFER',
    productId: '11111111-1111-4111-8111-111111111111',
    sourceLocationId: '',
    destinationLocationId: '',
    quantity: 5,
    performedBy: 'operator-1',
    notes: 'Operational stock transfer',
  };
  submittingMove = false;

  // Current logged in persona for approval testing
  currentApprover = 'store-manager-deshmukh';

  ngOnInit(): void {
    this.loadWarehouses();
    this.loadLocations();
    this.loadExpiringStock();
  }

  // Tab switching router
  selectTab(
    tab:
      | 'expiring-stock'
      | 'stock-on-hand'
      | 'moves'
      | 'lots'
      | 'reservations'
      | 'transfers'
      | 'scrap'
      | 'counts'
      | 'reconciliation'
      | 'new-move',
  ): void {
    this.activeTab = tab;
    if (tab === 'expiring-stock') this.loadExpiringStock();
    else if (tab === 'stock-on-hand') this.loadStockOnHand();
    else if (tab === 'moves') this.loadStockMoves();
    else if (tab === 'lots') this.loadLots();
    else if (tab === 'reservations') this.loadReservations();
    else if (tab === 'transfers') this.loadTransfers();
    else if (tab === 'scrap') this.loadScrapRequests();
    else if (tab === 'counts') this.loadCounts();
    else if (tab === 'reconciliation') this.runReconciliation();
  }

  // ==========================================
  // Master Data Loaders
  // ==========================================
  loadWarehouses(): void {
    this.api.getWarehouses().subscribe({
      next: (whs) => {
        this.warehouses = whs;
        this.warehousesMap.clear();
        for (const wh of whs) {
          this.warehousesMap.set(wh.id.toLowerCase(), wh);
        }
        if (whs.length > 0 && !this.transferForm.warehouseId) {
          this.transferForm.warehouseId = whs[0].id;
          this.countForm.warehouseId = whs[0].id;
        }
        this.cdr.markForCheck();
      },
      error: (err) => console.warn('Could not load warehouses:', err),
    });
  }

  loadLocations(): void {
    this.api.getLocations().subscribe({
      next: (locs) => {
        this.locations = locs;
        this.locationsMap.clear();
        for (const loc of locs) {
          this.locationsMap.set(loc.id.toLowerCase(), loc);
        }
        const internalLocs = locs.filter((l) => l.type === 'INTERNAL');
        if (internalLocs.length > 0) {
          if (!this.receiveLotForm.locationId) this.receiveLotForm.locationId = internalLocs[0].id;
          if (!this.fefoSaleForm.sourceLocationId) this.fefoSaleForm.sourceLocationId = internalLocs[0].id;
          if (!this.reservationForm.locationId) this.reservationForm.locationId = internalLocs[0].id;
          if (!this.transferForm.sourceLocationId) this.transferForm.sourceLocationId = internalLocs[0].id;
          if (internalLocs.length > 1 && !this.transferForm.destinationLocationId) {
            this.transferForm.destinationLocationId = internalLocs[1].id;
          }
          if (!this.scrapForm.sourceLocationId) this.scrapForm.sourceLocationId = internalLocs[0].id;
          if (!this.countForm.locationId) this.countForm.locationId = internalLocs[0].id;
          if (!this.newMove.sourceLocationId) this.newMove.sourceLocationId = internalLocs[0].id;
          if (internalLocs.length > 1 && !this.newMove.destinationLocationId) {
            this.newMove.destinationLocationId = internalLocs[1].id;
          }
        }
        this.cdr.markForCheck();
      },
      error: (err) => console.warn('Could not load locations:', err),
    });
  }

  getProductName(productId: string | null | undefined): string {
    if (!productId) return 'Unknown Product';
    const found = this.knownProducts.find(
      (p) => p.id.toLowerCase() === productId.toLowerCase(),
    );
    if (found) return found.name;
    return `Item (${productId.slice(0, 8)}…)`;
  }

  getProductSku(productId: string | null | undefined): string {
    if (!productId) return 'SKU-N/A';
    const found = this.knownProducts.find(
      (p) => p.id.toLowerCase() === productId.toLowerCase(),
    );
    return found ? found.sku : `SKU-${productId.slice(0, 8).toUpperCase()}`;
  }

  getLocationName(locationId: string | null | undefined): string {
    if (!locationId) return 'N/A';
    const loc = this.locationsMap.get(locationId.toLowerCase());
    return loc ? `${loc.name} (${loc.type})` : `Loc (${locationId.slice(0, 8)}…)`;
  }

  getStoreName(warehouseId: string | null | undefined): string {
    if (!warehouseId) return 'Main Store';
    const wh = this.warehousesMap.get(warehouseId.toLowerCase());
    return wh ? `${wh.name} [${wh.code}]` : `Store (${warehouseId.slice(0, 8)}…)`;
  }

  // ==========================================
  // 1. Expiring Stock Operations (Dashboard)
  // ==========================================
  loadExpiringStock(): void {
    this.loadingExpiring = true;
    this.api
      .getExpiringLots(
        this.horizonDays,
        this.expiringStoreFilter || undefined,
        this.expiringProductFilter || undefined,
      )
      .subscribe({
        next: (report) => {
          this.expiringReport = report;
          this.loadingExpiring = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadingExpiring = false;
          this.showAlert(err.error?.message || 'Failed to load expiring lots', 'error');
          this.cdr.markForCheck();
        },
      });
  }

  setExpiryHorizon(days: number): void {
    this.horizonDays = days;
    this.loadExpiringStock();
  }

  get filteredExpiringStores(): ExpiringStockStoreGroup[] {
    if (!this.expiringReport) return [];
    let stores = this.expiringReport.stores;

    if (this.expiringStoreFilter) {
      stores = stores.filter((s) => s.warehouseId === this.expiringStoreFilter);
    }

    if (this.expiringStatusFilter) {
      stores = stores
        .map((s) => ({
          ...s,
          items: s.items.filter((i) => i.status === this.expiringStatusFilter),
        }))
        .filter((s) => s.items.length > 0);
    }

    return stores;
  }

  // Quick Action Buttons from Expiring Stock Table
  openFefoSaleForExpiringItem(item: ExpiringLotItem): void {
    this.fefoSaleForm.productId = item.productId;
    this.fefoSaleForm.sourceLocationId = item.locationId;
    this.fefoSaleForm.quantity = Math.min(item.availableQuantity, 10) || 1;
    this.fefoSaleForm.orderReference = `POS-SALE-${Date.now().toString().slice(-6)}`;
    this.showFefoSaleModal = true;
  }

  openReserveForExpiringItem(item: ExpiringLotItem): void {
    this.reservationForm.productId = item.productId;
    this.reservationForm.locationId = item.locationId;
    this.reservationForm.lotId = item.lotId;
    this.reservationForm.quantity = Math.min(item.availableQuantity, 5) || 1;
    this.reservationForm.orderReference = `ORD-RES-${Date.now().toString().slice(-6)}`;
    this.showReservationModal = true;
  }

  openTransferForExpiringItem(item: ExpiringLotItem): void {
    this.transferForm.warehouseId = item.warehouseId;
    this.transferForm.sourceLocationId = item.locationId;
    this.transferForm.productId = item.productId;
    this.transferForm.lotId = item.lotId;
    this.transferForm.quantity = Math.min(item.availableQuantity, 10) || 1;
    // Auto-pick another internal location for destination
    const dest = this.locations.find(
      (l) => l.type === 'INTERNAL' && l.id !== item.locationId,
    );
    if (dest) this.transferForm.destinationLocationId = dest.id;
    this.showTransferModal = true;
  }

  openScrapForExpiringItem(item: ExpiringLotItem): void {
    this.scrapForm.productId = item.productId;
    this.scrapForm.lotId = item.lotId;
    this.scrapForm.sourceLocationId = item.locationId;
    this.scrapForm.quantity = item.onHandQuantity;
    this.scrapForm.reason = item.status === 'EXPIRED' ? 'EXPIRED_LOT' : 'QUALITY_FAIL';
    this.showScrapModal = true;
  }

  // ==========================================
  // 2. Lots & Batches Operations
  // ==========================================
  loadLots(): void {
    this.loadingLots = true;
    this.api.getLots(this.lotsProductFilter || undefined).subscribe({
      next: (lots) => {
        this.lots = lots;
        this.loadingLots = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loadingLots = false;
        this.showAlert(err.error?.message || 'Failed to load lots', 'error');
      },
    });
  }

  openReceiveLotModal(): void {
    this.receiveLotForm.lotName = `LOT-MILK-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    this.showReceiveLotModal = true;
  }

  submitReceiveLot(): void {
    this.api.receiveLot(this.receiveLotForm).subscribe({
      next: (res) => {
        this.showReceiveLotModal = false;
        this.showAlert(
          `Lot '${res.lot.name}' received (${this.receiveLotForm.quantity} units) with stock ledger entry.`,
          'success',
        );
        this.loadLots();
        this.loadExpiringStock();
      },
      error: (err) => this.showAlert(err.error?.message || 'Failed to receive lot', 'error'),
    });
  }

  submitFefoSale(): void {
    this.api.fefoSale(this.fefoSaleForm).subscribe({
      next: (res) => {
        this.showFefoSaleModal = false;
        this.showAlert(
          `FEFO Sale processed: ${res.totalQuantitySold} units allocated across ${res.allocations.length} lot(s).`,
          'success',
        );
        this.loadExpiringStock();
        this.loadStockOnHand();
      },
      error: (err) => this.showAlert(err.error?.message || 'FEFO Sale failed', 'error'),
    });
  }

  // ==========================================
  // 3. Reservations Operations
  // ==========================================
  loadReservations(): void {
    this.loadingReservations = true;
    this.api
      .getReservations(this.reservationStateFilter || undefined)
      .subscribe({
        next: (resList) => {
          this.reservations = resList;
          this.loadingReservations = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadingReservations = false;
          this.showAlert(err.error?.message || 'Failed to load reservations', 'error');
        },
      });
  }

  submitCreateReservation(): void {
    if (!this.reservationForm.orderReference) {
      this.reservationForm.orderReference = `ORD-${Date.now().toString().slice(-6)}`;
    }
    this.api
      .createReservation({
        ...this.reservationForm,
        lotId: this.reservationForm.lotId || undefined,
      })
      .subscribe({
        next: (res) => {
          this.showReservationModal = false;
          this.showAlert(
            `Reservation created (${res.quantity} units for order ${res.orderReference}). Auto-expires in ${this.reservationForm.timeoutMinutes} min.`,
            'success',
          );
          this.loadReservations();
          this.loadExpiringStock();
        },
        error: (err) =>
          this.showAlert(err.error?.message || 'Reservation failed (insufficient available stock)', 'error'),
      });
  }

  confirmReservation(id: string): void {
    this.api.confirmReservation(id).subscribe({
      next: () => {
        this.showAlert('Reservation confirmed! Committed for order picking.', 'success');
        this.loadReservations();
      },
      error: (err) => this.showAlert(err.error?.message || 'Confirm failed', 'error'),
    });
  }

  pickReservation(id: string): void {
    this.api.pickReservation(id).subscribe({
      next: () => {
        this.showAlert('Stock picked from shelf by warehouse staff.', 'success');
        this.loadReservations();
      },
      error: (err) => this.showAlert(err.error?.message || 'Pick failed', 'error'),
    });
  }

  deliverReservation(id: string): void {
    this.api.deliverReservation(id).subscribe({
      next: () => {
        this.showAlert('Order delivered! Stock deducted permanently from physical ledger.', 'success');
        this.loadReservations();
        this.loadExpiringStock();
      },
      error: (err) => this.showAlert(err.error?.message || 'Delivery failed', 'error'),
    });
  }

  cancelReservation(id: string, returnStock = true): void {
    this.api
      .cancelReservation(id, {
        cancelledBy: 'customer-support',
        reason: 'Customer requested cancellation',
        returnToOriginalLocation: returnStock,
        scrapReason: returnStock ? undefined : 'DAMAGED_ON_RETURN',
      })
      .subscribe({
        next: () => {
          this.showAlert('Reservation cancelled and reserved stock released.', 'info');
          this.loadReservations();
          this.loadExpiringStock();
        },
        error: (err) => this.showAlert(err.error?.message || 'Cancel failed', 'error'),
      });
  }

  // ==========================================
  // 4. Two-Step Transfers Operations
  // ==========================================
  loadTransfers(): void {
    this.loadingTransfers = true;
    this.api
      .getTransfers(
        this.transferWarehouseFilter || undefined,
        this.transferStateFilter || undefined,
      )
      .subscribe({
        next: (list) => {
          this.transfers = list;
          this.loadingTransfers = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadingTransfers = false;
          this.showAlert(err.error?.message || 'Failed to load transfers', 'error');
        },
      });
  }

  submitCreateTransfer(): void {
    this.api
      .createTransfer({
        type: this.transferForm.type,
        warehouseId: this.transferForm.warehouseId,
        sourceLocationId: this.transferForm.sourceLocationId || undefined,
        destinationLocationId: this.transferForm.destinationLocationId || undefined,
        notes: this.transferForm.notes,
        createdBy: this.transferForm.createdBy,
        lines: [
          {
            productId: this.transferForm.productId,
            lotId: this.transferForm.lotId || undefined,
            quantity: this.transferForm.quantity,
          },
        ],
      })
      .subscribe({
        next: (res) => {
          this.showTransferModal = false;
          this.showAlert(`Transfer created: ${res.transferNumber}`, 'success');
          this.loadTransfers();
        },
        error: (err) => this.showAlert(err.error?.message || 'Transfer creation failed', 'error'),
      });
  }

  dispatchTransfer(id: string): void {
    this.api
      .dispatchTransfer(id, { dispatchedBy: 'logistics-driver-singh' })
      .subscribe({
        next: (t) => {
          this.showAlert(
            `Transfer ${t.transferNumber} dispatched! Goods moved to TRANSIT location.`,
            'success',
          );
          this.loadTransfers();
          this.loadExpiringStock();
        },
        error: (err) => this.showAlert(err.error?.message || 'Dispatch failed', 'error'),
      });
  }

  openReceiveTransferModal(transfer: TransferItem): void {
    this.activeTransferForReceipt = transfer;
    this.receiveTransferForm.lines = transfer.lines.map((l) => ({
      productId: l.productId,
      lotId: l.lotId,
      dispatchedQuantity: Number(l.quantity),
      receivedQuantity: Number(l.quantity),
      shortageQuantity: 0,
      shortageReason: 'TRANSIT_DAMAGE',
    }));
    this.showReceiveTransferModal = true;
  }

  onReceiveQtyChange(index: number): void {
    const line = this.receiveTransferForm.lines[index];
    const diff = line.dispatchedQuantity - line.receivedQuantity;
    line.shortageQuantity = Math.max(0, Number(diff.toFixed(3)));
  }

  submitReceiveTransfer(): void {
    if (!this.activeTransferForReceipt) return;
    this.api
      .receiveTransfer(this.activeTransferForReceipt.id, {
        receivedBy: this.receiveTransferForm.receivedBy,
        lines: this.receiveTransferForm.lines.map((l) => ({
          productId: l.productId,
          lotId: l.lotId || undefined,
          receivedQuantity: l.receivedQuantity,
          shortageQuantity: l.shortageQuantity,
          shortageReason: l.shortageQuantity > 0 ? l.shortageReason : undefined,
        })),
      })
      .subscribe({
        next: (t) => {
          this.showReceiveTransferModal = false;
          this.showAlert(
            `Transfer ${t.transferNumber} received! Transit balanced to 0. Shortages reconciled into ledger.`,
            'success',
          );
          this.loadTransfers();
          this.loadExpiringStock();
        },
        error: (err) => this.showAlert(err.error?.message || 'Receipt failed', 'error'),
      });
  }

  // ==========================================
  // 5. Scrap & Two-Person Approval Operations
  // ==========================================
  loadScrapRequests(): void {
    this.loadingScrap = true;
    this.api.getScrapRequests(this.scrapStateFilter || undefined).subscribe({
      next: (list) => {
        this.scrapRequests = list;
        this.loadingScrap = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loadingScrap = false;
        this.showAlert(err.error?.message || 'Failed to load scrap requests', 'error');
      },
    });
  }

  submitCreateScrap(): void {
    this.api
      .createScrap({
        ...this.scrapForm,
        lotId: this.scrapForm.lotId || undefined,
      })
      .subscribe({
        next: (s) => {
          this.showScrapModal = false;
          this.showAlert(
            `Scrap request registered for ${s.quantity} units. Awaiting independent manager approval.`,
            'info',
          );
          this.loadScrapRequests();
        },
        error: (err) => this.showAlert(err.error?.message || 'Scrap request failed', 'error'),
      });
  }

  approveScrap(id: string): void {
    this.api.approveScrap(id, { approvedBy: this.currentApprover }).subscribe({
      next: () => {
        this.showAlert(
          `Scrap approved by ${this.currentApprover}! Stock moved to SCRAP location and written off.`,
          'success',
        );
        this.loadScrapRequests();
        this.loadExpiringStock();
      },
      error: (err) =>
        this.showAlert(
          err.error?.message || 'Approval rejected (Independent Two-Person Control: cannot approve own request)',
          'error',
        ),
    });
  }

  rejectScrap(id: string): void {
    this.api
      .rejectScrap(id, {
        rejectedBy: this.currentApprover,
        rejectionReason: 'Stock inspected and verified still usable',
      })
      .subscribe({
        next: () => {
          this.showAlert(`Scrap request rejected by ${this.currentApprover}.`, 'info');
          this.loadScrapRequests();
        },
        error: (err) => this.showAlert(err.error?.message || 'Rejection failed', 'error'),
      });
  }

  // ==========================================
  // 6. Physical Cycle Counts Operations
  // ==========================================
  loadCounts(): void {
    this.loadingCounts = true;
    this.api.getCounts().subscribe({
      next: (list) => {
        this.counts = list;
        this.loadingCounts = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.loadingCounts = false;
        this.showAlert(err.error?.message || 'Failed to load counts', 'error');
      },
    });
  }

  submitCreateCount(): void {
    this.api.createCount(this.countForm).subscribe({
      next: (c) => {
        this.showCountModal = false;
        this.showAlert(`Cycle count initiated: ${c.countNumber}. Baseline snapshot recorded.`, 'success');
        this.loadCounts();
      },
      error: (err) => this.showAlert(err.error?.message || 'Count creation failed', 'error'),
    });
  }

  openRecordCountModal(count: CountItem): void {
    this.api.getCountById(count.id).subscribe({
      next: (fullCount) => {
        this.activeCountForRecord = fullCount;
        this.recordLinesForm.lines = (fullCount.lines || []).map((l) => ({
          productId: l.productId,
          lotId: l.lotId,
          systemQuantity: Number(l.systemQuantity),
          countedQuantity: Number(l.countedQuantity) || Number(l.systemQuantity),
          notes: l.notes || '',
        }));
        this.showRecordLinesModal = true;
        this.cdr.markForCheck();
      },
      error: (err) => this.showAlert(err.error?.message || 'Failed to load count lines', 'error'),
    });
  }

  submitRecordCountLines(): void {
    if (!this.activeCountForRecord) return;
    this.api
      .recordCountLines(
        this.activeCountForRecord.id,
        this.recordLinesForm.lines.map((l) => ({
          productId: l.productId,
          lotId: l.lotId || undefined,
          countedQuantity: l.countedQuantity,
          notes: l.notes,
        })),
      )
      .subscribe({
        next: (c) => {
          this.showRecordLinesModal = false;
          this.showAlert(`Count lines recorded for ${c.countNumber}. Review status set.`, 'success');
          this.loadCounts();
        },
        error: (err) => this.showAlert(err.error?.message || 'Recording lines failed', 'error'),
      });
  }

  reconcileCount(countId: string): void {
    this.api.reconcileCount(countId, 'audit-director-sharma').subscribe({
      next: (res) => {
        this.showAlert(
          `Stock count reconciled! Posted ${res.adjustmentMovements?.length || 0} ADJUSTMENT movements to ledger.`,
          'success',
        );
        this.loadCounts();
        this.loadExpiringStock();
        this.loadStockOnHand();
      },
      error: (err) => this.showAlert(err.error?.message || 'Reconciliation failed', 'error'),
    });
  }

  // ==========================================
  // 7. Seed Demo Data (Multi-Store FreshMart)
  // ==========================================
  seedDemoData(): void {
    if (this.seedingData) return;
    this.seedingData = true;
    this.showAlert('Seeding FreshMart 25-Store Retailer Demo Inventory...', 'info');
    this.api.seedDemoData().subscribe({
      next: (res) => {
        this.seedingData = false;
        this.showAlert(
          res.message || 'FreshMart demo inventory seeded successfully!',
          'success',
        );
        this.loadWarehouses();
        this.loadLocations();
        this.loadExpiringStock();
        this.loadLots();
        this.loadStockOnHand();
        this.loadStockMoves();
      },
      error: (err) => {
        this.seedingData = false;
        this.showAlert(err.error?.message || 'Failed to seed sample inventory.', 'error');
      },
    });
  }

  // ==========================================
  // Helper & Utility Methods
  // ==========================================
  loadStockOnHand(page = 1): void {
    this.loadingSoh = true;
    this.api
      .getStockOnHand(
        page,
        this.quantsPagination.limit,
        this.sohProductFilter,
        this.sohLocationFilter,
      )
      .subscribe({
        next: (res) => {
          this.quants = res.data;
          this.quantsPagination = res.pagination;
          this.loadingSoh = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadingSoh = false;
          this.showAlert(err.error?.message || 'Failed to load stock on hand', 'error');
        },
      });
  }

  resetSohFilters(): void {
    this.sohProductFilter = '';
    this.sohLocationFilter = '';
    this.loadStockOnHand(1);
  }

  loadStockMoves(page = 1): void {
    this.loadingMoves = true;
    this.api
      .getStockMoves(
        page,
        this.movesPagination.limit,
        this.movesStateFilter || undefined,
        this.movesTypeFilter || undefined,
        this.movesProductFilter || undefined,
      )
      .subscribe({
        next: (res) => {
          this.moves = res.data;
          this.movesPagination = res.pagination;
          this.loadingMoves = false;
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loadingMoves = false;
          this.showAlert(err.error?.message || 'Failed to load stock moves', 'error');
        },
      });
  }

  runReconciliation(): void {
    this.loadingReconciliation = true;
    this.api.reconcileLedger(this.reconcileProductFilter || undefined).subscribe({
      next: (report) => {
        this.reconciliationReport = report;
        this.loadingReconciliation = false;
        if (report.status === 'RECONCILED') {
          this.showAlert(
            'Reconciliation Audit Passed: 0.000 Drift detected across all locations.',
            'success',
          );
        } else {
          this.showAlert(
            `Discrepancy detected: ${report.discrepanciesCount} items out of balance!`,
            'error',
          );
        }
      },
      error: (err) => {
        this.loadingReconciliation = false;
        this.showAlert(err.error?.message || 'Reconciliation audit failed', 'error');
      },
    });
  }

  showAlert(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    this.alertMessage = message;
    this.alertType = type;
    setTimeout(() => {
      if (this.alertMessage === message) {
        this.alertMessage = null;
      }
    }, 5000);
  }

  dismissAlert(): void {
    this.alertMessage = null;
  }

  formatRupees(paise: number): string {
    return `₹${(paise / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'EXPIRED':
        return 'badge-expired';
      case 'CRITICAL':
        return 'badge-critical';
      case 'WARNING':
        return 'badge-warning';
      case 'HEALTHY':
        return 'badge-healthy';
      case 'DONE':
      case 'APPROVED':
      case 'POSTED':
        return 'badge-healthy';
      case 'IN_PROGRESS':
      case 'CONFIRMED':
      case 'REVIEW':
        return 'badge-warning';
      case 'DRAFT':
      case 'PENDING_APPROVAL':
        return 'badge-info';
      case 'CANCELLED':
      case 'REJECTED':
        return 'badge-expired';
      default:
        return 'badge-info';
    }
  }
}
