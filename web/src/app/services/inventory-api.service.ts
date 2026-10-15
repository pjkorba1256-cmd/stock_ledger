import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CountItem,
  CreateStockMovePayload,
  ExpiringStockReport,
  LocationItem,
  LotItem,
  PaginatedResponse,
  ReconciliationReport,
  ReservationItem,
  ScrapItem,
  StockMove,
  StockQuant,
  TransferItem,
  WarehouseItem,
} from '../models/inventory.models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class InventoryApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  getStockOnHand(
    page = 1,
    limit = 20,
    productId?: string,
    locationId?: string,
  ): Observable<PaginatedResponse<StockQuant>> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (productId && productId.trim()) {
      params = params.set('productId', productId.trim());
    }

    if (locationId && locationId.trim()) {
      params = params.set('locationId', locationId.trim());
    }

    return this.http.get<PaginatedResponse<StockQuant>>(
      `${this.baseUrl}/stock-on-hand`,
      { params },
    );
  }

  getStockMoves(
    page = 1,
    limit = 20,
    state?: string,
    referenceType?: string,
    productId?: string,
    locationId?: string,
  ): Observable<PaginatedResponse<StockMove>> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (state && state.trim()) {
      params = params.set('state', state.trim());
    }

    if (referenceType && referenceType.trim()) {
      params = params.set('referenceType', referenceType.trim());
    }

    if (productId && productId.trim()) {
      params = params.set('productId', productId.trim());
    }

    if (locationId && locationId.trim()) {
      params = params.set('locationId', locationId.trim());
    }

    return this.http.get<PaginatedResponse<StockMove>>(
      `${this.baseUrl}/stock-moves`,
      { params },
    );
  }

  createStockMove(payload: CreateStockMovePayload): Observable<StockMove> {
    return this.http.post<StockMove>(`${this.baseUrl}/stock-moves`, payload);
  }

  confirmStockMove(id: string): Observable<StockMove> {
    return this.http.post<StockMove>(
      `${this.baseUrl}/stock-moves/${id}/confirm`,
      {},
    );
  }

  postStockMove(id: string): Observable<StockMove> {
    return this.http.post<StockMove>(
      `${this.baseUrl}/stock-moves/${id}/post`,
      {},
    );
  }

  cancelStockMove(id: string): Observable<StockMove> {
    return this.http.post<StockMove>(
      `${this.baseUrl}/stock-moves/${id}/cancel`,
      {},
    );
  }

  reconcileLedger(productId?: string): Observable<ReconciliationReport> {
    let params = new HttpParams();
    if (productId && productId.trim()) {
      params = params.set('productId', productId.trim());
    }

    return this.http.get<ReconciliationReport>(`${this.baseUrl}/reconcile`, {
      params,
    });
  }

  seedDemoData(): Observable<{ success: boolean; message: string; movesCreated?: number }> {
    return this.http.post<{ success: boolean; message: string; movesCreated?: number }>(
      `${this.baseUrl}/seed`,
      {},
    );
  }

  getLocations(): Observable<LocationItem[]> {
    return this.http.get<LocationItem[]>(`${this.baseUrl}/locations`);
  }

  getWarehouses(): Observable<WarehouseItem[]> {
    return this.http.get<WarehouseItem[]>(`${this.baseUrl}/warehouses`);
  }

  updateQuantReservation(id: string, reservedQuantity: number): Observable<StockQuant> {
    return this.http.patch<StockQuant>(`${this.baseUrl}/quants/${id}/reserve`, {
      reservedQuantity,
    });
  }

  // ==========================================
  // P03: Expiring Lots & FreshMart Operations
  // ==========================================

  getExpiringLots(
    days = 7,
    warehouseId?: string,
    productId?: string,
  ): Observable<ExpiringStockReport> {
    let params = new HttpParams().set('days', days.toString());
    if (warehouseId && warehouseId.trim()) {
      params = params.set('warehouseId', warehouseId.trim());
    }
    if (productId && productId.trim()) {
      params = params.set('productId', productId.trim());
    }
    return this.http.get<ExpiringStockReport>(`${this.baseUrl}/expiring-lots`, {
      params,
    });
  }

  getLots(productId?: string): Observable<LotItem[]> {
    let params = new HttpParams();
    if (productId && productId.trim()) {
      params = params.set('productId', productId.trim());
    }
    return this.http.get<LotItem[]>(`${this.baseUrl}/lots`, { params });
  }

  receiveLot(payload: {
    productId: string;
    lotName: string;
    locationId: string;
    quantity: number;
    unitCostPaise?: number;
    manufacturingDate?: string;
    expiryDate?: string;
    performedBy: string;
    notes?: string;
  }): Observable<{ lot: LotItem; quant: StockQuant; movement: StockMove }> {
    return this.http.post<{ lot: LotItem; quant: StockQuant; movement: StockMove }>(
      `${this.baseUrl}/lots/receive`,
      payload,
    );
  }

  fefoSale(payload: {
    productId: string;
    sourceLocationId: string;
    quantity: number;
    performedBy: string;
    orderReference?: string;
  }): Observable<{
    success: boolean;
    productId: string;
    totalQuantitySold: number;
    allocations: Array<{
      quantId: string;
      lotId: string | null;
      lotName: string | null;
      expiryDate: string | null;
      allocatedQuantity: number;
      unitCostPaise?: number | null;
    }>;
  }> {
    return this.http.post<{
      success: boolean;
      productId: string;
      totalQuantitySold: number;
      allocations: Array<{
        quantId: string;
        lotId: string | null;
        lotName: string | null;
        expiryDate: string | null;
        allocatedQuantity: number;
        unitCostPaise?: number | null;
      }>;
    }>(`${this.baseUrl}/lots/fefo-sale`, payload);
  }

  // ==========================================
  // P03: Reservations
  // ==========================================

  getReservations(state?: string, productId?: string): Observable<ReservationItem[]> {
    let params = new HttpParams();
    if (state && state.trim()) {
      params = params.set('state', state.trim());
    }
    if (productId && productId.trim()) {
      params = params.set('productId', productId.trim());
    }
    return this.http.get<ReservationItem[]>(`${this.baseUrl}/reservations`, {
      params,
    });
  }

  createReservation(payload: {
    merchantId: string;
    orderReference: string;
    productId: string;
    locationId: string;
    lotId?: string;
    quantity: number;
    timeoutMinutes: number;
    createdBy: string;
  }): Observable<ReservationItem> {
    return this.http.post<ReservationItem>(`${this.baseUrl}/reservations`, payload);
  }

  confirmReservation(id: string, confirmedBy = 'order-processing'): Observable<ReservationItem> {
    return this.http.post<ReservationItem>(
      `${this.baseUrl}/reservations/${id}/confirm`,
      { confirmedBy },
    );
  }

  pickReservation(id: string, pickedBy = 'warehouse-picker'): Observable<ReservationItem> {
    return this.http.post<ReservationItem>(
      `${this.baseUrl}/reservations/${id}/pick`,
      { pickedBy },
    );
  }

  deliverReservation(
    id: string,
    customerLocationId?: string,
    deliveredBy = 'delivery-courier',
  ): Observable<{ reservation: ReservationItem; movement: StockMove }> {
    return this.http.post<{ reservation: ReservationItem; movement: StockMove }>(
      `${this.baseUrl}/reservations/${id}/deliver`,
      { customerLocationId, deliveredBy },
    );
  }

  cancelReservation(
    id: string,
    payload: {
      cancelledBy: string;
      reason?: string;
      returnToOriginalLocation?: boolean;
      scrapReason?: string;
    },
  ): Observable<ReservationItem> {
    return this.http.post<ReservationItem>(
      `${this.baseUrl}/reservations/${id}/cancel`,
      payload,
    );
  }

  // ==========================================
  // P03: Two-Step Inter-Store Transfers
  // ==========================================

  getTransfers(warehouseId?: string, state?: string): Observable<TransferItem[]> {
    let params = new HttpParams();
    if (warehouseId && warehouseId.trim()) {
      params = params.set('warehouseId', warehouseId.trim());
    }
    if (state && state.trim()) {
      params = params.set('state', state.trim());
    }
    return this.http.get<TransferItem[]>(`${this.baseUrl}/transfers`, { params });
  }

  createTransfer(payload: {
    type: string;
    warehouseId: string;
    sourceLocationId?: string;
    destinationLocationId?: string;
    scheduledDate?: string;
    notes?: string;
    createdBy: string;
    lines: Array<{ productId: string; lotId?: string; quantity: number }>;
  }): Observable<TransferItem> {
    return this.http.post<TransferItem>(`${this.baseUrl}/transfers`, payload);
  }

  dispatchTransfer(
    id: string,
    payload: { dispatchedBy: string; transitLocationId?: string },
  ): Observable<TransferItem> {
    return this.http.post<TransferItem>(
      `${this.baseUrl}/transfers/${id}/dispatch`,
      payload,
    );
  }

  receiveTransfer(
    id: string,
    payload: {
      receivedBy: string;
      lines: Array<{
        productId: string;
        lotId?: string;
        receivedQuantity: number;
        shortageQuantity?: number;
        shortageReason?: string;
      }>;
    },
  ): Observable<TransferItem> {
    return this.http.post<TransferItem>(
      `${this.baseUrl}/transfers/${id}/receive`,
      payload,
    );
  }

  // ==========================================
  // P03: Scrap Operations
  // ==========================================

  getScrapRequests(state?: string): Observable<ScrapItem[]> {
    let params = new HttpParams();
    if (state && state.trim()) {
      params = params.set('state', state.trim());
    }
    return this.http.get<ScrapItem[]>(`${this.baseUrl}/scrap`, { params });
  }

  createScrap(payload: {
    productId: string;
    lotId?: string;
    sourceLocationId: string;
    scrapLocationId?: string;
    quantity: number;
    reason: string;
    requestedBy: string;
  }): Observable<ScrapItem> {
    return this.http.post<ScrapItem>(`${this.baseUrl}/scrap`, payload);
  }

  approveScrap(
    id: string,
    payload: { approvedBy: string },
  ): Observable<{ scrap: ScrapItem; movement: StockMove }> {
    return this.http.post<{ scrap: ScrapItem; movement: StockMove }>(
      `${this.baseUrl}/scrap/${id}/approve`,
      payload,
    );
  }

  rejectScrap(
    id: string,
    payload: { rejectedBy: string; rejectionReason?: string },
  ): Observable<ScrapItem> {
    return this.http.post<ScrapItem>(`${this.baseUrl}/scrap/${id}/reject`, payload);
  }

  // ==========================================
  // P03: Physical Stock Counts
  // ==========================================

  getCounts(warehouseId?: string): Observable<CountItem[]> {
    let params = new HttpParams();
    if (warehouseId && warehouseId.trim()) {
      params = params.set('warehouseId', warehouseId.trim());
    }
    return this.http.get<CountItem[]>(`${this.baseUrl}/counts`, { params });
  }

  getCountById(id: string): Observable<CountItem> {
    return this.http.get<CountItem>(`${this.baseUrl}/counts/${id}`);
  }

  createCount(payload: {
    warehouseId: string;
    locationId: string;
    countedBy: string;
    notes?: string;
  }): Observable<CountItem> {
    return this.http.post<CountItem>(`${this.baseUrl}/counts`, payload);
  }

  recordCountLines(
    id: string,
    lines: Array<{
      productId: string;
      lotId?: string;
      countedQuantity: number;
      notes?: string;
    }>,
  ): Observable<CountItem> {
    return this.http.post<CountItem>(`${this.baseUrl}/counts/${id}/record`, {
      lines,
    });
  }

  reconcileCount(
    id: string,
    approvedBy: string,
    lossLocationId?: string,
  ): Observable<{
    success: boolean;
    count: CountItem;
    adjustmentMovements: StockMove[];
  }> {
    return this.http.post<{
      success: boolean;
      count: CountItem;
      adjustmentMovements: StockMove[];
    }>(`${this.baseUrl}/counts/${id}/reconcile`, {
      approvedBy,
      lossLocationId,
    });
  }
}
