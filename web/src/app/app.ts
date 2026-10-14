import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryApiService } from './services/inventory-api.service';
import {
  CreateStockMovePayload,
  LocationItem,
  Pagination,
  ReconciliationReport,
  ReferenceType,
  StockMove,
  StockQuant,
} from './models/inventory.models';

export interface CatalogProduct {
  id: string;
  name: string;
  sku: string;
}

export const KNOWN_PRODUCTS: CatalogProduct[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Apple MacBook Pro 16" M3 Max',
    sku: 'MBP-16-M3M',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Dell UltraSharp 32" 4K Monitor',
    sku: 'DEL-U32-4K',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Keychron Q1 Pro Mechanical Keyboard',
    sku: 'KEY-Q1-PRO',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Sony WH-1000XM5 ANC Headphones',
    sku: 'SNY-WH1000-M5',
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Logitech MX Master 3S Mouse',
    sku: 'LOG-MX-3S',
  },
  {
    id: 'fde0a9c4-24ad-495d-8b2a-fc7e42038e5a',
    name: 'High-Tensile Steel Rods (10mm)',
    sku: 'STL-ROD-10',
  },
  {
    id: 'c7287c2a-c0b1-439d-83fd-39a3309588f1',
    name: 'Industrial Cement Bags (50kg)',
    sku: 'CMT-BAG-50',
  },
  {
    id: '002c517d-8539-465a-86d1-a70ce12b29d3',
    name: 'Structural Aluminum Angle (2in)',
    sku: 'ALM-ANG-20',
  },
  {
    id: '69edcf40-1e34-4a85-a544-772fe830c4c8',
    name: 'Hardwood Plywood Sheet (18mm)',
    sku: 'PLY-SHT-18',
  },
];

const DEFAULT_LOCATIONS: Record<string, string> = {
  'd2961899-7090-4d21-94ef-81e63aeb646d': 'Global Vendor Partner (Inbound)',
  '7172f4fd-8c7c-4115-adff-9fd36ff84ecd': 'Storage Area (Rack A - Vault)',
  '5571a122-f657-452c-ae2f-7387005512a4': 'Receiving Area 2 (Rack B - Picking Bins)',
  '88888888-8888-4888-8888-888888888888': 'Customer Fulfillment Dock (Outward)',
  '6f869dce-8bb7-46fb-b27d-ed7c2211acf0': 'Vendor Source',
  '0241d0b0-d4c8-4cf0-99c0-bc4900946326': 'Main Storage Zone',
  '9998e5ca-fa69-4ff8-969d-7344016aadb8': 'Packing Zone',
  'b5796ae1-641d-4bc6-aae6-fd937fcc413b': 'Vendor Source',
  'd526f8be-5238-471b-b3d1-177937c8276d': 'Main Storage Zone',
  'babb61d2-ef92-4efc-9947-5250a6941afc': 'Packing Zone',
};

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


  activeTab: 'stock-on-hand' | 'moves' | 'new-move' | 'reconciliation' =
    'stock-on-hand';

  // Sidebar toggle state
  sidebarCollapsed = false;

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  // Dashboard widgets state (matching reference image)
  timeframes: ('Day' | 'Week' | 'Month' | 'Year')[] = ['Day', 'Week', 'Month', 'Year'];
  timeframe: 'Day' | 'Week' | 'Month' | 'Year' = 'Month';
  globalSearch = '';
  chartBars = [
    { month: 'Jan', height: 68, isGray: false },
    { month: 'Feb', height: 55, isGray: false },
    { month: 'Mar', height: 92, isGray: true },
    { month: 'Apr', height: 48, isGray: false },
    { month: 'May', height: 82, isGray: false },
    { month: 'Jun', height: 36, isGray: false },
  ];
  calendarDays = [
    { day: 'Tue', date: 13, active: false },
    { day: 'Wed', date: 14, active: true },
    { day: 'Thu', date: 15, active: false },
    { day: 'Fri', date: 16, active: false },
    { day: 'Sat', date: 17, active: false },
  ];

  setTimeframe(tf: 'Day' | 'Week' | 'Month' | 'Year'): void {
    this.timeframe = tf;
    this.showAlert(`Dashboard timeframe updated to: ${tf}`, 'info');
  }

  // Stock on hand state
  quants: StockQuant[] = [];
  quantsPagination: Pagination = { page: 1, limit: 10, total: 0, totalPages: 0 };
  sohProductFilter = '';
  sohLocationFilter = '';
  loadingSoh = false;

  // Stock moves state
  moves: StockMove[] = [];
  movesPagination: Pagination = { page: 1, limit: 10, total: 0, totalPages: 0 };
  movesStateFilter = '';
  movesTypeFilter = '';
  movesProductFilter = '';
  loadingMoves = false;

  // New move form state
  newMove: CreateStockMovePayload = {
    referenceType: 'TRANSFER',
    productId: '11111111-1111-4111-8111-111111111111',
    sourceLocationId: '7172f4fd-8c7c-4115-adff-9fd36ff84ecd',
    destinationLocationId: '5571a122-f657-452c-ae2f-7387005512a4',
    quantity: 5,
    performedBy: 'operator-1',
    notes: 'Operational stock transfer',
  };
  submittingMove = false;

  // Reconciliation report state
  reconciliationReport: ReconciliationReport | null = null;
  reconcileProductFilter = '';
  loadingReconciliation = false;

  // Master catalog and dynamic locations
  readonly knownProducts: CatalogProduct[] = KNOWN_PRODUCTS;
  locations: LocationItem[] = [];
  locationsMap = new Map<string, LocationItem>();

  // Global alert & copy feedback state
  alertMessage: string | null = null;
  alertType: 'success' | 'error' | 'info' = 'info';
  copiedField: string | null = null;
  seedingData = false;

  ngOnInit(): void {
    this.loadLocations();
    this.loadStockOnHand();
    this.loadStockMoves();
  }

  loadLocations(): void {
    this.api.getLocations().subscribe({
      next: (locs) => {
        this.locations = locs;
        this.locationsMap.clear();
        for (const loc of locs) {
          this.locationsMap.set(loc.id.toLowerCase(), loc);
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.warn('Could not load locations from API, falling back to defaults:', err);
      },
    });
  }

  getProductName(productId: string | null | undefined): string {
    if (!productId) return 'Unknown Product';
    const found = this.knownProducts.find(
      (p) => p.id.toLowerCase() === productId.toLowerCase(),
    );
    if (found) return found.name;
    return `Product (${productId.slice(0, 8)}…)`;
  }

  getLocationName(locationId: string | null | undefined): string {
    if (!locationId) return 'Unknown Location';
    const loc = this.locationsMap.get(locationId.toLowerCase());
    if (loc) return loc.name;
    const def = DEFAULT_LOCATIONS[locationId.toLowerCase()];
    if (def) return def;
    return `Location (${locationId.slice(0, 8)}…)`;
  }

  getLocationCode(locationId: string | null | undefined): string | null {
    if (!locationId) return null;
    const loc = this.locationsMap.get(locationId.toLowerCase());
    return loc ? loc.code : null;
  }

  seedDemoData(): void {
    if (this.seedingData) return;
    this.seedingData = true;
    this.showAlert('Seeding demo warehouses, locations, and movements...', 'info');
    this.api.seedDemoData().subscribe({
      next: (res) => {
        this.seedingData = false;
        this.showAlert(
          res.message || 'Sample inventory loaded successfully! Quants and movements updated.',
          'success',
        );
        this.loadLocations();
        this.loadStockOnHand(1);
        this.loadStockMoves(1);
      },
      error: (err) => {
        this.seedingData = false;
        this.showAlert(
          err.error?.message || 'Failed to seed sample inventory.',
          'error',
        );
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

  copyToClipboard(text: string, label: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.copiedField = text;
      this.showAlert(`Copied ${label} (${text.slice(0, 8)}...) to clipboard`, 'info');
      setTimeout(() => {
        if (this.copiedField === text) {
          this.copiedField = null;
        }
      }, 2500);
    }
  }

  refreshAll(): void {
    this.loadLocations();
    this.loadStockOnHand(this.quantsPagination.page);
    this.loadStockMoves(this.movesPagination.page);
    this.showAlert('Ledger, locations, and snapshot tables synced with database', 'info');
  }

  // Presets for rapid evaluator demonstration
  applyInternalTransferPreset(): void {
    this.newMove.referenceType = 'TRANSFER';
    this.newMove.productId = '11111111-1111-4111-8111-111111111111';
    this.newMove.sourceLocationId = '7172f4fd-8c7c-4115-adff-9fd36ff84ecd'; // Storage Area
    this.newMove.destinationLocationId = '5571a122-f657-452c-ae2f-7387005512a4'; // Receiving Area 2
    this.newMove.quantity = 5;
    this.newMove.notes = 'Internal transfer from Storage to Receiving';
    this.showAlert('Applied preset: Internal Transfer (Storage -> Receiving)', 'info');
  }

  applySupplierGrnPreset(): void {
    this.newMove.referenceType = 'GRN';
    this.newMove.productId = '11111111-1111-4111-8111-111111111111';
    this.newMove.sourceLocationId = 'd2961899-7090-4d21-94ef-81e63aeb646d'; // Vendor Partner
    this.newMove.destinationLocationId = '7172f4fd-8c7c-4115-adff-9fd36ff84ecd'; // Storage Area
    this.newMove.quantity = 25;
    this.newMove.notes = 'Goods receipt inward from Vendor';
    this.showAlert('Applied preset: Supplier GRN (Vendor -> Storage)', 'info');
  }

  // Tab 1: Stock on Hand
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
          this.cdr.markForCheck();
          this.showAlert(
            err.error?.message || 'Failed to load stock on hand',
            'error',
          );
        },
      });
  }

  resetSohFilters(): void {
    this.sohProductFilter = '';
    this.sohLocationFilter = '';
    this.loadStockOnHand(1);
  }

  get totalInventoryUnits(): number {
    return this.quants.reduce((acc, q) => acc + Number(q.quantity), 0);
  }

  // Tab 2: Stock Moves
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
          this.cdr.markForCheck();
          this.showAlert(
            err.error?.message || 'Failed to load stock movements',
            'error',
          );
        },
      });
  }

  resetMovesFilters(): void {
    this.movesStateFilter = '';
    this.movesTypeFilter = '';
    this.movesProductFilter = '';
    this.loadStockMoves(1);
  }

  confirmMove(id: string): void {
    this.api.confirmStockMove(id).subscribe({
      next: () => {
        this.showAlert(`Movement ${id.slice(0, 8)} confirmed! Ready for posting.`, 'success');
        this.loadStockMoves(this.movesPagination.page);
      },
      error: (err) => {
        this.showAlert(
          err.error?.message || 'Failed to confirm movement',
          'error',
        );
      },
    });
  }

  postMove(id: string): void {
    this.api.postStockMove(id).subscribe({
      next: () => {
        this.showAlert(
          `Movement ${id.slice(0, 8)} executed! Quants updated atomically.`,
          'success',
        );
        this.loadStockMoves(this.movesPagination.page);
        this.loadStockOnHand(this.quantsPagination.page);
      },
      error: (err) => {
        this.showAlert(
          err.error?.message || 'Posting failed (insufficient stock or constraint violation)',
          'error',
        );
      },
    });
  }

  cancelMove(id: string): void {
    this.api.cancelStockMove(id).subscribe({
      next: () => {
        this.showAlert(`Movement ${id.slice(0, 8)} cancelled.`, 'info');
        this.loadStockMoves(this.movesPagination.page);
      },
      error: (err) => {
        this.showAlert(
          err.error?.message || 'Cannot cancel this movement',
          'error',
        );
      },
    });
  }

  // Tab 3: Create Move
  submitCreateMove(): void {
    if (
      !this.newMove.sourceLocationId.trim() ||
      !this.newMove.destinationLocationId.trim()
    ) {
      this.showAlert(
        'Source and destination location IDs are required',
        'error',
      );
      return;
    }

    if (
      this.newMove.sourceLocationId.trim() ===
      this.newMove.destinationLocationId.trim()
    ) {
      this.showAlert(
        'Source and destination locations must be different',
        'error',
      );
      return;
    }

    this.submittingMove = true;
    this.api.createStockMove(this.newMove).subscribe({
      next: (created) => {
        this.submittingMove = false;
        this.showAlert(
          `Draft movement recorded (ID: ${created.id.slice(0, 8)}). Confirm it in Ledger.`,
          'success',
        );
        this.activeTab = 'moves';
        this.loadStockMoves(1);
      },
      error: (err) => {
        this.submittingMove = false;
        this.showAlert(
          err.error?.message || 'Failed to record movement',
          'error',
        );
      },
    });
  }

  // Tab 4: Reconciliation
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
        this.showAlert(
          err.error?.message || 'Reconciliation audit failed',
          'error',
        );
      },
    });
  }
}
