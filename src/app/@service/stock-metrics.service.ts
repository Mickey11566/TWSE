import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, of, switchMap } from 'rxjs';

export interface QuarterlyEps {
  year: number;
  quarter: number;
  value: number;
}

export interface InstitutionalFlow {
  foreignNetShares: number;
  trustNetShares: number;
  dealerNetShares: number;
  totalNetShares: number;
}

export interface DailyInstitutionalData {
  date: string;
  byCode: Map<string, InstitutionalFlow>;
}

export interface TwseEpsRow {
  年度?: string;
  季別?: string;
  公司代號?: string;
  '基本每股盈餘(元)'?: string;
}

interface TwseInstitutionalResponse {
  stat?: string;
  fields?: string[];
  data?: string[][];
}

@Injectable({ providedIn: 'root' })
export class StockMetricsService {
  private readonly quarterlyEpsUrl = '/twse-api/v1/opendata/t187ap14_L';
  private readonly institutionalUrl = '/twse-data/rwd/zh/fund/T86';

  constructor(private http: HttpClient) {}

  /** 取得證交所公布的上市公司季度 EPS 資料。 */
  getQuarterlyEps(): Observable<Map<string, QuarterlyEps[]>> {
    return this.http.get<TwseEpsRow[]>(this.quarterlyEpsUrl).pipe(
      map((rows) => {
        const results = new Map<string, QuarterlyEps[]>();

        for (const row of rows ?? []) {
          const code = row['公司代號']?.trim();
          const year = this.parseYear(row['年度']);
          const quarter = this.parseQuarter(row['季別']);
          const value = this.parseNumber(row['基本每股盈餘(元)']);
          if (!code || year === null || quarter === null || value === null) continue;

          const entries = results.get(code) ?? [];
          entries.push({ year, quarter, value });
          results.set(code, entries);
        }

        for (const entries of results.values()) {
          entries.sort((a, b) => b.year - a.year || b.quarter - a.quarter);
        }
        return results;
      }),
    );
  }

  /** 取得最近有資料的證交所三大法人買賣超日報，最多回溯 7 個日曆日。 */
  getLatestInstitutionalData(): Observable<DailyInstitutionalData | null> {
    return this.fetchInstitutionalData(this.getTaipeiDate(), 0);
  }

  private fetchInstitutionalData(date: Date, dayOffset: number): Observable<DailyInstitutionalData | null> {
    const dateCode = this.formatApiDate(date);
    const params = new HttpParams()
      .set('date', dateCode)
      .set('selectType', 'ALL')
      .set('response', 'json');

    return this.http.get<TwseInstitutionalResponse>(this.institutionalUrl, { params }).pipe(
      map((response) => this.parseInstitutionalResponse(response, date)),
      catchError(() => of(null)),
      switchMap((result) => {
        if (result || dayOffset >= 7) return of(result);
        const previousDate = new Date(date);
        previousDate.setDate(previousDate.getDate() - 1);
        return this.fetchInstitutionalData(previousDate, dayOffset + 1);
      }),
    );
  }

  private parseInstitutionalResponse(
    response: TwseInstitutionalResponse,
    date: Date,
  ): DailyInstitutionalData | null {
    const rows = response?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const fields = response.fields ?? [];
    const codeIndex = this.findFieldIndex(fields, ['證券代號', '股票代號'], 0);
    const foreignIndex = this.findFieldIndex(fields, ['外陸資買賣超股數(不含外資自營商)', '外資及陸資買賣超股數'], 4);
    const trustIndex = this.findFieldIndex(fields, ['投信買賣超股數'], 10);
    const dealerIndex = this.findFieldIndex(fields, ['自營商買賣超股數'], 11, ['自行買賣', '避險']);
    const totalIndex = this.findFieldIndex(fields, ['三大法人買賣超股數'], 18);
    const byCode = new Map<string, InstitutionalFlow>();

    for (const row of rows) {
      const code = row[codeIndex]?.trim();
      if (!code || !/^\d{4,6}$/.test(code)) continue;

      const foreignNetShares = this.parseNumber(row[foreignIndex]) ?? 0;
      const trustNetShares = this.parseNumber(row[trustIndex]) ?? 0;
      const dealerNetShares = this.parseNumber(row[dealerIndex]) ?? 0;
      const totalNetShares = this.parseNumber(row[totalIndex]) ?? foreignNetShares + trustNetShares + dealerNetShares;

      byCode.set(code, { foreignNetShares, trustNetShares, dealerNetShares, totalNetShares });
    }

    return byCode.size ? { date: this.formatDisplayDate(date), byCode } : null;
  }

  private findFieldIndex(fields: string[], candidates: string[], fallback: number, excludes: string[] = []): number {
    const found = fields.findIndex((field) =>
      candidates.some((candidate) => field.includes(candidate)) &&
      !excludes.some((excluded) => field.includes(excluded)),
    );
    return found >= 0 ? found : fallback;
  }

  private parseYear(value?: string): number | null {
    const match = value?.match(/\d{3,4}/);
    if (!match) return null;
    const year = Number(match[0]);
    return year < 1911 ? year + 1911 : year;
  }

  private parseQuarter(value?: string): number | null {
    if (!value) return null;
    const chineseQuarter = value.match(/[一二三四]/)?.[0];
    if (chineseQuarter) return ['一', '二', '三', '四'].indexOf(chineseQuarter) + 1;
    const quarterMatch = value.match(/(?:第\s*)?([1-4])\s*季|(?:Q|q)\s*([1-4])|^\s*([1-4])\s*$/);
    const quarter = quarterMatch?.[1] ?? quarterMatch?.[2] ?? quarterMatch?.[3];
    return quarter ? Number(quarter) : null;
  }

  private parseNumber(value?: string): number | null {
    if (!value || value.trim() === '--') return null;
    const normalized = value.replace(/,/g, '').trim();
    const negative = normalized.startsWith('(') && normalized.endsWith(')');
    const parsed = Number(normalized.replace(/[()+]/g, ''));
    if (!Number.isFinite(parsed)) return null;
    return negative ? -parsed : parsed;
  }

  private getTaipeiDate(): Date {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    return new Date(year, month - 1, day, 12);
  }

  private formatApiDate(date: Date): string {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  }

  private formatDisplayDate(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
