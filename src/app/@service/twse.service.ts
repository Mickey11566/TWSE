import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable, shareReplay } from 'rxjs';

export interface TwseDailyQuote {
  code: string;
  name: string;
  tradeVolume: number;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  previousClose: number;
}

interface TwseApiRow {
  Code?: string;
  Name?: string;
  TradeVolume?: string;
  OpeningPrice?: string;
  HighestPrice?: string;
  LowestPrice?: string;
  ClosingPrice?: string;
  Change?: string;
}

export interface MarketOverviewData {
  index: number;
  change: number;
  changePercent: number;
  turnover: number;
  date?: string;
}

interface FmtqikRow {
  Date?: string;
  TradeVolume?: string;
  TradeValue?: string;
  Transaction?: string;
  TAIEX?: string;
  Change?: string;
}

@Injectable({ providedIn: 'root' })
export class TwseService {
  private readonly stockDayAllUrl = '/twse-api/v1/exchangeReport/STOCK_DAY_ALL';
  private readonly fmtqikUrl = '/twse-api/v1/exchangeReport/FMTQIK';

  /** 快取全市場資料，避免重複呼叫 API */
  private allQuotes$: Observable<TwseDailyQuote[]> | null = null;

  constructor(private http: HttpClient) {}

  /** 取得大盤加權指數與市場概況 */
  getMarketOverview(): Observable<MarketOverviewData | null> {
    return this.http.get<FmtqikRow[]>(this.fmtqikUrl).pipe(
      map((rows) => {
        if (!rows || rows.length === 0) return null;
        const latest = rows[rows.length - 1];
        const index = this.toNumber(latest.TAIEX) ?? 49313.44;
        const change = this.toNumber(latest.Change) ?? 0;
        const turnoverVal = this.toNumber(latest.TradeValue) ?? 0;
        const turnover = Math.round(turnoverVal / 100000000); // 轉成「億」
        const prevIndex = index - change;
        const changePercent = prevIndex > 0 ? Number(((change / prevIndex) * 100).toFixed(2)) : 0;
        return {
          index,
          change,
          changePercent,
          turnover,
          date: latest.Date,
        };
      }),
      shareReplay(1),
    );
  }

  /** 取得全市場股票即時報價列表 */
  getAllStocks(): Observable<TwseDailyQuote[]> {
    if (!this.allQuotes$) {
      this.allQuotes$ = this.http.get<TwseApiRow[]>(this.stockDayAllUrl).pipe(
        map((rows) =>
          rows
            .map((row) => this.toDailyQuote(row))
            .filter((q): q is TwseDailyQuote => q !== null),
        ),
        shareReplay(1),
      );
    }
    return this.allQuotes$;
  }

  /** 依代碼清單取得每日收盤報價 */
  getDailyQuotes(stockCodes: string[]): Observable<TwseDailyQuote[]> {
    return this.getAllStocks().pipe(
      map((quotes) => quotes.filter((q) => stockCodes.includes(q.code))),
    );
  }

  /** 依代碼查詢單一股票（用於新增前預覽） */
  searchStock(code: string): Observable<TwseDailyQuote | null> {
    const normalized = code.trim().toUpperCase();
    return this.getAllStocks().pipe(
      map((quotes) => quotes.find((q) => q.code === normalized) ?? null),
    );
  }

  /** 清除快取（需要重新抓資料時呼叫） */
  clearCache(): void {
    this.allQuotes$ = null;
  }

  private toDailyQuote(row: TwseApiRow): TwseDailyQuote | null {
    const close = this.toNumber(row.ClosingPrice);
    if (!row.Code || !row.Name || close === null) return null;
    const change = this.toNumber(row.Change) ?? 0;
    const previousClose = Number((close - change).toFixed(2));

    return {
      code: row.Code,
      name: row.Name,
      tradeVolume: this.toNumber(row.TradeVolume) ?? 0,
      open: this.toNumber(row.OpeningPrice) ?? close,
      high: this.toNumber(row.HighestPrice) ?? close,
      low: this.toNumber(row.LowestPrice) ?? close,
      close,
      change,
      previousClose,
    };
  }

  private toNumber(value?: string): number | null {
    if (!value || value === '--') return null;
    const normalized = value.replace(/,/g, '').replace('+', '').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

