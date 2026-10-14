import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  CreateStockMovePayload,
  LocationItem,
  PaginatedResponse,
  ReconciliationReport,
  StockMove,
  StockQuant,
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
}
