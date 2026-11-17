import { CommonModule } from '@angular/common';
import { Component, computed, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  ScanProgress,
  ScanScope,
  SignalRating,
  TechnicalAnalysisService,
  TechnicalIndicators,
} from './@service/technical-analysis.service';
import { TwseDailyQuote, TwseService } from './@service/twse.service';
import {
  InstitutionalFlow,
  QuarterlyEps,
  StockMetricsService,
} from './@service/stock-metrics.service';

type ActiveTab = 'WATCHLIST' | 'SCANNER';
type FilterType = 'DOUBLE_GOLD' | 'RSI_GOLD' | 'MACD_GOLD' | 'TRIPLE' | 'ALL';
type PriceDirection = 'UP' | 'DOWN' | 'FLAT';

interface MarketOverview {
  index: number;
  change: number;
  changePercent: number;
  turnover: number;
  risingCount: number;
  fallingCount: number;
  foreignNetBuy: number;
}

type SignalState = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';

interface PotentialSignal {
  label: string;
  state: SignalState;
}

interface SelectedStockMetrics {
  latestEps: QuarterlyEps | null;
  epsYearOverYear: number | null;
  forwardPe: number | null;
  institutionalDate: string | null;
  institutionalFlow: InstitutionalFlow | null;
  potentialScore: number;
  evaluatedSignalCount: number;
  potentialLabel: string;
  signals: PotentialSignal[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  // =========================
  // 頁面工作區與篩選狀態
  // =========================
  activeTab = signal<ActiveTab>('WATCHLIST');
  filterType = signal<FilterType>('DOUBLE_GOLD');
  scanScope = signal<ScanScope>('HOT_100');
  searchKeyword = '';
  filterByMa5Bias = signal<boolean>(true); // 預設開啟：股價不偏離 MA5 超過 5%

  toggleMa5BiasFilter(): void {
    this.filterByMa5Bias.update((v) => !v);
  }

  // =========================
  // 市場大盤概況
  // =========================
  marketOverview: MarketOverview = {
    index: 49313.44,
    change: -492.93,
    changePercent: -0.99,
    turnover: 9245,
    risingCount: 0,
    fallingCount: 0,
    foreignNetBuy: 0,
  };
  marketStatus: 'OPEN' | 'CLOSED' = 'OPEN';
  quoteSource = '證交所 OpenAPI + 即時技術運算';

  // =========================
  // 基本面與法人籌碼資料
  // =========================
  quarterlyEpsByCode = signal<Map<string, QuarterlyEps[]>>(new Map());
  institutionalFlowByCode = signal<Map<string, InstitutionalFlow>>(new Map());
  institutionalDataDate = signal<string | null>(null);
  isLoadingEps = false;
  isLoadingInstitutional = false;

  // =========================
  // 全市場股票清單快取
  // =========================
  allTwseStocks: TwseDailyQuote[] = [];
  isLoadingTwse = false;

  // =========================
  // 觀察名單 (Watchlist)
  // =========================
  watchlist = signal<TechnicalIndicators[]>([]);
  isLoadingWatchlist = false;

  // =========================
  // 掃描器 (Scanner)
  // =========================
  isScanning = false;
  scanProgress = signal<ScanProgress>({
    scanned: 0,
    total: 0,
    percent: 0,
    doubleGoldCount: 0,
    rsiGoldCount: 0,
    macdGoldCount: 0,
    tripleCount: 0,
    isCompleted: false,
  });
  scannedStocks = signal<TechnicalIndicators[]>([]);
  private abortController: AbortController | null = null;

  // =========================
  // 當前選中檢視的個股
  // =========================
  selectedStockCode = signal<string>('2330');

  // =========================
  // 手動查詢新增 Dialog
  // =========================
  isAddDialogVisible = false;
  newStockCode = '';
  isSearchingManual = false;
  manualSearchResult: TechnicalIndicators | null = null;
  manualSearchError = '';

  // Toast 訊息提示
  toastMessage = '';
  private toastTimer: any = null;

  private subs = new Subscription();

  constructor(
    private twseService: TwseService,
    private techService: TechnicalAnalysisService,
    private stockMetricsService: StockMetricsService,
  ) {}

  ngOnInit(): void {
    this.loadInitialMarketData();
  }

  ngOnDestroy(): void {
    this.stopScan();
    this.subs.unsubscribe();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  // ==========================================
  // 初始化載入台股清單與觀察名單
  // ==========================================
  private loadInitialMarketData(): void {
    this.loadFundamentalAndInstitutionalData();

    // 取得最新加權指數與成交金額
    this.twseService.getMarketOverview().subscribe({
      next: (overview) => {
        if (overview) {
          this.marketOverview = {
            ...this.marketOverview,
            index: overview.index,
            change: overview.change,
            changePercent: overview.changePercent,
            turnover: overview.turnover,
          };
        }
      },
      error: (err) => console.warn('[TWSE] Failed to load market overview:', err),
    });

    this.isLoadingTwse = true;
    this.twseService.getAllStocks().subscribe({
      next: (quotes) => {
        this.isLoadingTwse = false;
        // 篩選出 4 位數標準普通股，並依成交量由大到小排序
        this.allTwseStocks = quotes
          .filter((q) => /^\d{4}$/.test(q.code))
          .sort((a, b) => b.tradeVolume - a.tradeVolume);

        // 載入儲存的觀察名單
        this.refreshWatchlist();
      },
      error: (err) => {
        this.isLoadingTwse = false;
        console.error('[TWSE] Failed to load all stocks:', err);
        this.showToast('無法取得證交所股票清單，請確認網路連線');
      },
    });
  }

  private loadFundamentalAndInstitutionalData(): void {
    this.isLoadingEps = true;
    this.subs.add(this.stockMetricsService.getQuarterlyEps().subscribe({
      next: (epsByCode) => {
        this.quarterlyEpsByCode.set(epsByCode);
        this.isLoadingEps = false;
      },
      error: (err) => {
        console.warn('[TWSE] Failed to load quarterly EPS:', err);
        this.isLoadingEps = false;
      },
    }));

    this.isLoadingInstitutional = true;
    this.subs.add(this.stockMetricsService.getLatestInstitutionalData().subscribe({
      next: (dailyData) => {
        if (dailyData) {
          this.institutionalDataDate.set(dailyData.date);
          this.institutionalFlowByCode.set(dailyData.byCode);
        }
        this.isLoadingInstitutional = false;
      },
      error: (err) => {
        console.warn('[TWSE] Failed to load institutional flow:', err);
        this.isLoadingInstitutional = false;
      },
    }));
  }

  refreshStockMetrics(): void {
    this.loadFundamentalAndInstitutionalData();
  }

  /**
   * 重新計算並載入觀察名單中的所有個股
   */
  async refreshWatchlist(): Promise<void> {
    const codes = this.techService.getStoredWatchlistCodes();
    if (codes.length === 0) {
      this.watchlist.set([]);
      return;
    }

    this.isLoadingWatchlist = true;
    const quoteMap = new Map(this.allTwseStocks.map((q) => [q.code, q]));
    const results: TechnicalIndicators[] = [];

    for (const code of codes) {
      let quote = quoteMap.get(code);
      if (!quote) {
        quote = {
          code,
          name: code,
          tradeVolume: 0,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          change: 0,
          previousClose: 0,
        };
      }
      const indicators = await this.techService.analyzeStock(quote);
      if (indicators) {
        results.push(indicators);
      }
    }

    this.watchlist.set(results);
    this.isLoadingWatchlist = false;

    // 若當前選取的股票不在清單中，預設選取第一檔
    if (results.length > 0 && !results.some((s) => s.code === this.selectedStockCode())) {
      this.selectedStockCode.set(results[0].code);
    }
  }

  // ==========================================
  // 全市場 RSI & MACD 批量掃描引擎
  // ==========================================
  async startScan(): Promise<void> {
    if (this.isScanning) return;
    if (this.allTwseStocks.length === 0) {
      this.showToast('尚在載入證交所股票清單，請稍候...');
      return;
    }

    this.isScanning = true;
    this.scannedStocks.set([]);
    this.abortController = new AbortController();

    // 1. 決定掃描標的名單
    let targetStocks: TwseDailyQuote[] = [];
    switch (this.scanScope()) {
      case 'HOT_50':
        targetStocks = this.allTwseStocks.slice(0, 50);
        break;
      case 'HOT_100':
        targetStocks = this.allTwseStocks.slice(0, 100);
        break;
      case 'TOP_300':
        targetStocks = this.allTwseStocks.slice(0, 300);
        break;
      case 'ALL_MARKET':
        targetStocks = this.allTwseStocks;
        break;
      case 'WATCHLIST':
        const watchedCodes = new Set(this.techService.getStoredWatchlistCodes());
        targetStocks = this.allTwseStocks.filter((s) => watchedCodes.has(s.code));
        break;
    }

    const total = targetStocks.length;
    let scanned = 0;
    let doubleGoldCount = 0;
    let rsiGoldCount = 0;
    let macdGoldCount = 0;
    let tripleCount = 0;

    this.scanProgress.set({
      scanned: 0,
      total,
      percent: 0,
      doubleGoldCount: 0,
      rsiGoldCount: 0,
      macdGoldCount: 0,
      tripleCount: 0,
      isCompleted: false,
    });

    // 2. 平行並行掃描 (Concurrency = 5，避免發送過急)
    const concurrency = 5;
    let currentIndex = 0;
    const accumulated: TechnicalIndicators[] = [];

    const worker = async () => {
      while (currentIndex < targetStocks.length) {
        if (this.abortController?.signal.aborted) break;

        const stock = targetStocks[currentIndex++];
        try {
          const indicators = await this.techService.analyzeStock(stock);
          if (indicators) {
            accumulated.push(indicators);
            if (indicators.isDoubleGoldenCross) doubleGoldCount++;
            if (indicators.isRsiGoldenCross) rsiGoldCount++;
            if (indicators.isMacdGoldenCross) macdGoldCount++;
            if (indicators.triple.isAllMet) tripleCount++;

            // 動態更新已掃描的股票列表
            this.scannedStocks.set([...accumulated]);
          }
        } catch {}

        scanned++;
        const percent = Math.min(100, Math.round((scanned / total) * 100));

        this.scanProgress.set({
          scanned,
          total,
          percent,
          currentStock: `${stock.code} ${stock.name}`,
          doubleGoldCount,
          rsiGoldCount,
          macdGoldCount,
          tripleCount,
          isCompleted: false,
        });
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
    await Promise.all(workers);

    this.isScanning = false;
    this.scanProgress.update((prev) => ({
      ...prev,
      percent: 100,
      isCompleted: true,
    }));

    this.showToast(`掃描完成！共分析 ${scanned} 檔股票，發現 ${doubleGoldCount} 檔雙黃金交叉標的！`);
  }

  stopScan(): void {
    if (this.isScanning) {
      this.abortController?.abort();
      this.isScanning = false;
      this.showToast('已停止掃描');
    }
  }

  // ==========================================
  // 一鍵將所有符合「雙黃金交叉」的股票加入觀察名單
  // ==========================================
  addAllDoubleGoldToWatchlist(): void {
    let doubleGoldStocks = this.scannedStocks().filter((s) => s.isDoubleGoldenCross);
    if (this.filterByMa5Bias()) {
      doubleGoldStocks = doubleGoldStocks.filter((s) => s.isWithinMa5Bias);
    }
    if (doubleGoldStocks.length === 0) {
      this.showToast('目前掃描結果中無符合條件 (雙金叉 且 偏離MA5≤5%) 的股票');
      return;
    }

    const codes = doubleGoldStocks.map((s) => s.code);
    const addedCount = this.techService.addAllToWatchlist(codes);

    // 重新載入觀察名單
    this.refreshWatchlist();
    this.showToast(`已成功將 ${addedCount} 檔【雙金叉且未偏離MA5超過5%】標的加入觀察名單！`);

    // 自動切換到觀察名單分頁
    this.activeTab.set('WATCHLIST');
    if (doubleGoldStocks.length > 0) {
      this.selectedStockCode.set(doubleGoldStocks[0].code);
    }
  }

  // ==========================================
  // 觀察名單單檔操作
  // ==========================================
  toggleWatchlist(stock: TechnicalIndicators, event?: Event): void {
    event?.stopPropagation();
    const code = stock.code;
    if (this.techService.isStockInWatchlist(code)) {
      this.techService.removeFromWatchlist(code);
      this.showToast(`已從觀察名單移除 ${stock.name} (${code})`);
    } else {
      this.techService.addToWatchlist(code);
      this.showToast(`已加入觀察名單 ${stock.name} (${code})`);
    }
    this.refreshWatchlist();
  }

  removeStockFromWatchlist(code: string, event?: Event): void {
    event?.stopPropagation();
    this.techService.removeFromWatchlist(code);
    this.showToast(`已移除股票代號 ${code}`);
    this.refreshWatchlist();
  }

  isWatched(code: string): boolean {
    return this.techService.isStockInWatchlist(code);
  }

  // ==========================================
  // 當前選取股票計算
  // ==========================================
  selectedStock = computed<TechnicalIndicators | null>(() => {
    const code = this.selectedStockCode();
    // 優先在目前活躍的列表中尋找
    const activeList =
      this.activeTab() === 'WATCHLIST' ? this.watchlist() : this.scannedStocks();
    const found = activeList.find((s) => s.code === code);
    if (found) return found;

    // 若沒找到，在另一列表中尋找
    const otherList =
      this.activeTab() === 'WATCHLIST' ? this.scannedStocks() : this.watchlist();
    return otherList.find((s) => s.code === code) ?? activeList[0] ?? otherList[0] ?? null;
  });

  selectedStockMetrics = computed<SelectedStockMetrics | null>(() => {
    const stock = this.selectedStock();
    if (!stock) return null;

    const epsRecords = this.quarterlyEpsByCode().get(stock.code) ?? [];
    const latestEps = epsRecords[0] ?? null;
    const priorYearEps = latestEps
      ? epsRecords.find((entry) => entry.year === latestEps.year - 1 && entry.quarter === latestEps.quarter) ?? null
      : null;
    const epsYearOverYear = latestEps && priorYearEps && priorYearEps.value !== 0
      ? Number((((latestEps.value - priorYearEps.value) / Math.abs(priorYearEps.value)) * 100).toFixed(2))
      : null;
    const annualizedEps = latestEps && latestEps.value > 0 ? latestEps.value * 4 : null;
    const forwardPe = annualizedEps && stock.price > 0
      ? Number((stock.price / annualizedEps).toFixed(2))
      : null;
    const institutionalFlow = this.institutionalFlowByCode().get(stock.code) ?? null;

    const signals: PotentialSignal[] = [
      { label: '最新季 EPS 為正', state: latestEps ? (latestEps.value > 0 ? 'POSITIVE' : 'NEGATIVE') : 'UNKNOWN' },
      { label: 'EPS 年增', state: epsYearOverYear === null ? 'UNKNOWN' : (epsYearOverYear > 0 ? 'POSITIVE' : 'NEGATIVE') },
      { label: '年化 Forward PE ≤ 20', state: forwardPe === null ? 'UNKNOWN' : (forwardPe <= 20 ? 'POSITIVE' : 'NEGATIVE') },
      { label: '法人當日合計買超', state: institutionalFlow ? (institutionalFlow.totalNetShares > 0 ? 'POSITIVE' : 'NEGATIVE') : 'UNKNOWN' },
      { label: 'RSI / MACD 雙金叉', state: stock.isDoubleGoldenCross ? 'POSITIVE' : 'NEGATIVE' },
    ];

    const evaluatedSignalCount = signals.filter((signal) => signal.state !== 'UNKNOWN').length;
    const potentialScore = signals.filter((signal) => signal.state === 'POSITIVE').length;
    let potentialLabel = '資料不足';
    if (evaluatedSignalCount >= 4) {
      if (latestEps && latestEps.value > 0 && potentialScore >= 4) {
        potentialLabel = '潛力股候選';
      } else if (potentialScore >= 3) {
        potentialLabel = '偏多觀察';
      } else {
        potentialLabel = '訊號不足';
      }
    }

    return {
      latestEps,
      epsYearOverYear,
      forwardPe,
      institutionalDate: this.institutionalDataDate(),
      institutionalFlow,
      potentialScore,
      evaluatedSignalCount,
      potentialLabel,
      signals,
    };
  });

  selectStock(code: string): void {
    this.selectedStockCode.set(code);
  }

  // ==========================================
  // 清單篩選與過濾
  // ==========================================
  filteredWatchlist = computed(() => {
    const list = this.watchlist();
    const kw = this.searchKeyword.trim();
    return list.filter((s) => {
      const matchKw = !kw || s.code.includes(kw) || s.name.includes(kw);
      if (!matchKw) return false;
      return this.matchesFilterType(s);
    });
  });

  filteredScannedStocks = computed(() => {
    const list = this.scannedStocks();
    const kw = this.searchKeyword.trim();
    return list.filter((s) => {
      const matchKw = !kw || s.code.includes(kw) || s.name.includes(kw);
      if (!matchKw) return false;
      return this.matchesFilterType(s);
    });
  });

  private matchesFilterType(s: TechnicalIndicators): boolean {
    // 條件一：若啟用「不偏離 MA5 超過 5%」過濾，必須符合 |ma5Bias| <= 5%
    if (this.filterByMa5Bias() && !s.isWithinMa5Bias) {
      return false;
    }

    switch (this.filterType()) {
      case 'DOUBLE_GOLD':
        return s.isDoubleGoldenCross;
      case 'RSI_GOLD':
        return s.isRsiGoldenCross;
      case 'MACD_GOLD':
        return s.isMacdGoldenCross;
      case 'TRIPLE':
        return s.triple.isAllMet;
      case 'ALL':
      default:
        return true;
    }
  }

  // 統計總覽
  doubleGoldWatchlistCount = computed(
    () => this.watchlist().filter((s) => s.isDoubleGoldenCross).length,
  );
  rsiGoldWatchlistCount = computed(
    () => this.watchlist().filter((s) => s.isRsiGoldenCross).length,
  );
  macdGoldWatchlistCount = computed(
    () => this.watchlist().filter((s) => s.isMacdGoldenCross).length,
  );
  tripleWatchlistCount = computed(
    () => this.watchlist().filter((s) => s.triple.isAllMet).length,
  );

  // ==========================================
  // 手動查詢新增 Dialog
  // ==========================================
  openAddDialog(): void {
    this.newStockCode = '';
    this.manualSearchResult = null;
    this.manualSearchError = '';
    this.isAddDialogVisible = true;
  }

  closeAddDialog(): void {
    this.isAddDialogVisible = false;
    this.manualSearchResult = null;
    this.manualSearchError = '';
  }

  async searchManualStock(): Promise<void> {
    const code = this.newStockCode.trim().toUpperCase();
    if (!code) return;

    this.isSearchingManual = true;
    this.manualSearchResult = null;
    this.manualSearchError = '';

    const quote = this.allTwseStocks.find((q) => q.code === code);
    if (!quote) {
      this.isSearchingManual = false;
      this.manualSearchError = `找不到股票代號「${code}」，請確認是否為台股上市股票`;
      return;
    }

    try {
      const indicators = await this.techService.analyzeStock(quote);
      this.isSearchingManual = false;
      if (indicators) {
        this.manualSearchResult = indicators;
      } else {
        this.manualSearchError = `股票代號「${code}」歷史數據不足以計算 RSI / MACD`;
      }
    } catch {
      this.isSearchingManual = false;
      this.manualSearchError = '技術指標運算異常，請稍後重試';
    }
  }

  confirmAddManualStock(): void {
    if (!this.manualSearchResult) return;
    const code = this.manualSearchResult.code;
    this.techService.addToWatchlist(code);
    this.refreshWatchlist();
    this.selectedStockCode.set(code);
    this.closeAddDialog();
    this.showToast(`已將 ${this.manualSearchResult.name} (${code}) 加入觀察名單`);
  }

  // ==========================================
  // SVG 圖表繪製輔助方法
  // ==========================================

  /**
   * 產出折線圖的 SVG Path (d 屬性)
   */
  getSvgLinePath(values: number[], width: number = 380, height: number = 100, min?: number, max?: number): string {
    if (!values || values.length < 2) return '';

    const effectiveMin = min !== undefined ? min : Math.min(...values);
    const effectiveMax = max !== undefined ? max : Math.max(...values);
    const range = effectiveMax - effectiveMin || 1;

    const stepX = width / (values.length - 1);
    const points = values.map((val, idx) => {
      const x = Number((idx * stepX).toFixed(1));
      // y 座標：值越大越往上 (y 越小)
      const normalizedY = 1 - (val - effectiveMin) / range;
      const y = Number((normalizedY * (height - 16) + 8).toFixed(1));
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  }

  /**
   * 計算 MACD 柱狀體 (OSC) 的 SVG Rects
   */
  getMacdOscBars(oscValues: number[], width: number = 380, height: number = 100): Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    isUp: boolean;
    val: number;
  }> {
    if (!oscValues || oscValues.length === 0) return [];

    const absMax = Math.max(...oscValues.map((v) => Math.abs(v))) || 1;
    const zeroY = height / 2;
    const halfH = height / 2 - 8;
    const stepX = width / oscValues.length;
    const barWidth = Math.max(3, stepX - 3);

    return oscValues.map((val, idx) => {
      const isUp = val >= 0;
      const barH = Number((Math.min(1, Math.abs(val) / absMax) * halfH).toFixed(1));
      const x = Number((idx * stepX + 1.5).toFixed(1));
      const y = isUp ? Number((zeroY - barH).toFixed(1)) : zeroY;

      return {
        x,
        y,
        w: barWidth,
        h: Math.max(2, barH),
        isUp,
        val,
      };
    });
  }

  // ==========================================
  // 工具與外觀輔助
  // ==========================================
  getDirection(value: number): PriceDirection {
    if (value > 0) return 'UP';
    if (value < 0) return 'DOWN';
    return 'FLAT';
  }

  getDirectionClass(value: number): string {
    const direction = this.getDirection(value);
    if (direction === 'UP') return 'price-up';
    if (direction === 'DOWN') return 'price-down';
    return 'price-flat';
  }

  private showToast(msg: string): void {
    this.toastMessage = msg;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage = '';
    }, 3200);
  }
}
