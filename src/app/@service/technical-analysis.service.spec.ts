import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { TechnicalAnalysisService } from './technical-analysis.service';

describe('TechnicalAnalysisService - 三條件選股', () => {
  let service: TechnicalAnalysisService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] });
    service = TestBed.inject(TechnicalAnalysisService);
  });

  it('SMA 與布林中軌一致，上軌 > 中軌 > 下軌', () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i) * 3);
    const sma = service.calcSMA(values, 20);
    const bb = service.calcBollinger(values, 20, 2);
    expect(Number.isNaN(sma[18])).toBeTrue();
    expect(bb.middle[29]).toBeCloseTo(sma[29], 8);
    expect(bb.upper[29]).toBeGreaterThan(bb.middle[29]);
    expect(bb.lower[29]).toBeLessThan(bb.middle[29]);
  });

  it('盤整後最後一天大漲：三條件全部成立', () => {
    // 40 天上升趨勢（月線向上）→ 8 天回檔（MACD 柱狀體轉負）→ 最後一天突破大漲
    const closes: number[] = [];
    for (let i = 0; i < 40; i++) closes.push(100 + i * 0.5);
    for (let i = 1; i <= 8; i++) closes.push(119.5 - i * 0.6);
    closes.push(132);

    const r = service.calcTripleSignal(closes, closes, 800_000)!;
    expect(r.isMacdTurnPositive).withContext(`osc ${r.wOscPrev} -> ${r.wOsc}`).toBeTrue();
    expect(r.isBollingerExpanding).toBeTrue();
    expect(r.isAboveRisingMa20).toBeTrue();
    expect(r.volumeLots).toBe(800);
    expect(r.isAllMet).toBeTrue();
  });

  it('成交量不足 500 張時不成立', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = service.calcTripleSignal(closes, closes, 499_999)!;
    expect(r.isVolumeEnough).toBeFalse();
    expect(r.isAllMet).toBeFalse();
  });

  it('一路下跌：站上上揚月線不成立', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 200 - i);
    const r = service.calcTripleSignal(closes, closes, 1_000_000)!;
    expect(r.isAboveRisingMa20).toBeFalse();
    expect(r.isAllMet).toBeFalse();
  });

  it('資料不足時回傳 null', () => {
    expect(service.calcTripleSignal([1, 2, 3], [1, 2, 3], 0)).toBeNull();
  });
});
