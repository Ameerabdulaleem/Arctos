import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';
import { Sparkles, Loader2, X, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

/** Volume bar forwarded alongside candles */
export interface VolumeBar {
  time: Time;
  value: number;
  color?: string;
}

/**
 * Props accepted by TradingViewChart.
 *
 * Live-data integration:
 *   Pass `candles` + `volume` from your TradingView / exchange WebSocket feed.
 *   The component will render whatever data you supply.
 *   When these props are **omitted** the component falls back to its built-in
 *   mock data generator so the UI remains functional during development.
 *
 * `onCandleUpdate` is called with the chart's candle & volume series so the
 * parent can push incremental updates via `series.update()` without needing
 * to re-render the whole tree.
 */
interface TradingViewChartProps {
  symbol: string;
  interval: ChartInterval;
  onIntervalChange: (interval: ChartInterval) => void;
  /** Optional – supply live OHLCV candles. When present, mock data is bypassed. */
  candles?: CandlestickData<Time>[];
  /** Optional – supply live volume bars matching `candles`. */
  volume?: VolumeBar[];
  /**
   * Called once after chart + series are mounted so the parent can push
   * incremental candle updates via `candleSeries.update(tick)`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSeriesReady?: (candleSeries: any, volumeSeries: any) => void;
}

/* ------------------------------------------------------------------ */
/*  Technical Analysis Utilities                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Minimum candle count required for AI analysis                      */
/* ------------------------------------------------------------------ */
const MIN_CANDLES_FOR_AI = 30;

function calcEMA(data: number[], period: number): number[] {
  if (data.length === 0) return [];
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  let prev = data[0];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      prev = data.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
    } else {
      prev = (data[i] - prev) * multiplier + prev;
    }
    ema.push(Number.isFinite(prev) ? prev : data[i]);
  }
  return ema;
}

function calcRSI(closes: number[], period = 14): number[] {
  if (closes.length < 2) return closes.map(() => 50);
  const rsi: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { rsi.push(50); continue; }
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i <= period) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) { rsi.push(100); continue; }
    const rs = avgGain / avgLoss;
    const val = 100 - 100 / (1 + rs);
    rsi.push(Number.isFinite(val) ? val : 50);
  }
  return rsi;
}

function findSupportResistance(candles: CandlestickData<Time>[]): { support: number; resistance: number } {
  if (candles.length === 0) return { support: 0, resistance: 0 };
  if (candles.length < 20) {
    const lows  = candles.map((c) => c.low);
    const highs = candles.map((c) => c.high);
    return { support: Math.min(...lows), resistance: Math.max(...highs) };
  }
  const recent = candles.slice(-50);
  const lows  = recent.map((c) => c.low).sort((a, b) => a - b);
  const highs = recent.map((c) => c.high).sort((a, b) => b - a);

  const clusterSize = Math.min(5, lows.length);
  const support    = lows.slice(0, clusterSize).reduce((a, b) => a + b, 0) / clusterSize;
  const resistance = highs.slice(0, clusterSize).reduce((a, b) => a + b, 0) / clusterSize;
  return { support, resistance };
}

interface AIAnalysisResult {
  signal: 'STRONG BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG SELL';
  confidence: number;
  reasons: string[];
  ema9Last: number;
  ema21Last: number;
  rsiLast: number;
  support: number;
  resistance: number;
  entryPrice: number;
  longTP: number;
  longSL: number;
  shortTP: number;
  shortSL: number;
}

type AIToolKey = 'ema' | 'supportResistance' | 'longPosition' | 'shortPosition';

interface AIToolOption {
  key: AIToolKey;
  label: string;
  description: string;
  color: string;
}

function runAIAnalysis(candles: CandlestickData<Time>[]): AIAnalysisResult {
  const closes = candles.map((c) => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const rsi = calcRSI(closes, 14);

  const ema9Last = ema9[ema9.length - 1];
  const ema21Last = ema21[ema21.length - 1];
  const rsiLast = rsi[rsi.length - 1];
  const { support, resistance } = findSupportResistance(candles);
  const lastClose = closes[closes.length - 1];

  let score = 0;
  const reasons: string[] = [];

  // EMA Crossover analysis
  const ema9Prev = ema9[ema9.length - 3];
  const ema21Prev = ema21[ema21.length - 3];
  if (ema9Last > ema21Last && ema9Prev <= ema21Prev) {
    score += 2;
    reasons.push('EMA 9/21 bullish crossover detected');
  } else if (ema9Last < ema21Last && ema9Prev >= ema21Prev) {
    score -= 2;
    reasons.push('EMA 9/21 bearish crossover detected');
  } else if (ema9Last > ema21Last) {
    score += 1;
    reasons.push('EMA 9 above EMA 21 — uptrend intact');
  } else {
    score -= 1;
    reasons.push('EMA 9 below EMA 21 — downtrend pressure');
  }

  // RSI analysis
  if (rsiLast < 30) {
    score += 2;
    reasons.push(`RSI oversold at ${rsiLast.toFixed(1)} — bounce likely`);
  } else if (rsiLast > 70) {
    score -= 2;
    reasons.push(`RSI overbought at ${rsiLast.toFixed(1)} — pullback risk`);
  } else if (rsiLast > 50) {
    score += 1;
    reasons.push(`RSI bullish at ${rsiLast.toFixed(1)}`);
  } else {
    score -= 1;
    reasons.push(`RSI bearish at ${rsiLast.toFixed(1)}`);
  }

  // Support/Resistance analysis
  const distToSupport = ((lastClose - support) / lastClose) * 100;
  const distToResistance = ((resistance - lastClose) / lastClose) * 100;

  if (distToSupport < 2) {
    score += 1;
    reasons.push(`Price near support at $${support.toFixed(2)} — potential bounce zone`);
  }
  if (distToResistance < 2) {
    score -= 1;
    reasons.push(`Price near resistance at $${resistance.toFixed(2)} — rejection possible`);
  }
  if (distToResistance > distToSupport * 2) {
    score += 1;
    reasons.push('More upside room than downside risk');
  }

  let signal: AIAnalysisResult['signal'];
  if (score >= 4) signal = 'STRONG BUY';
  else if (score >= 2) signal = 'BUY';
  else if (score <= -4) signal = 'STRONG SELL';
  else if (score <= -2) signal = 'SELL';
  else signal = 'NEUTRAL';

  const confidence = Math.min(95, 50 + Math.abs(score) * 10);

  // Position calculations (2:1 risk-reward). Clamp risk so TP/SL stay sane
  // when price sits right on support or resistance.
  const rr = 2;
  const minRisk = lastClose * 0.005; // floor at 0.5 % of price
  const longSL   = support;
  const longRisk = Math.max(lastClose - longSL, minRisk);
  const longTP   = lastClose + longRisk * rr;
  const shortSL   = resistance;
  const shortRisk = Math.max(shortSL - lastClose, minRisk);
  const shortTP   = lastClose - shortRisk * rr;

  return { signal, confidence, reasons, ema9Last, ema21Last, rsiLast, support, resistance, entryPrice: lastClose, longTP, longSL, shortTP, shortSL };
}

/* ------------------------------------------------------------------ */
/*  Mock OHLCV generator (replaced by live feed when backend is ready) */
/* ------------------------------------------------------------------ */

function generateMockCandles(count: number, interval: ChartInterval): CandlestickData<Time>[] {
  const now = Math.floor(Date.now() / 1000);
  const intervalSeconds: Record<ChartInterval, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };
  const step = intervalSeconds[interval];

  let open = 45000 + Math.random() * 2000;
  const candles: CandlestickData<Time>[] = [];

  for (let i = count; i >= 0; i--) {
    const time = (now - i * step) as Time;
    const close = open + (Math.random() - 0.48) * 300;
    const high = Math.max(open, close) + Math.random() * 150;
    const low = Math.min(open, close) - Math.random() * 150;
    candles.push({ time, open, high, low, close });
    open = close;
  }

  return candles;
}

function generateMockVolume(candles: CandlestickData<Time>[]) {
  return candles.map((c) => ({
    time: c.time,
    value: Math.random() * 500 + 50,
    color: c.close >= c.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)',
  }));
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const INTERVALS: ChartInterval[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

const AI_TOOLS: AIToolOption[] = [
  { key: 'ema', label: 'EMA Crossover', description: 'EMA 9 & 21 overlays', color: '#facc15' },
  { key: 'supportResistance', label: 'Support / Resistance', description: 'Key S/R levels', color: '#22c55e' },
  { key: 'longPosition', label: 'Long Position', description: 'Entry, TP & SL for longs', color: '#22c55e' },
  { key: 'shortPosition', label: 'Short Position', description: 'Entry, TP & SL for shorts', color: '#ef4444' },
];

export default function TradingViewChart({
  symbol,
  interval,
  onIntervalChange,
  candles: liveCandles,
  volume: liveVolume,
  onSeriesReady,
}: TradingViewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeriesRef = useRef<any>(null);
  const candlesRef = useRef<CandlestickData<Time>[]>([]);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);

  // AI drawing state
  const [aiDrawn, setAiDrawn] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [selectedTools, setSelectedTools] = useState<Set<AIToolKey>>(new Set(['ema', 'supportResistance']));
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiSeriesRefs = useRef<any[]>([]);
  /** Guards against the AI setTimeout firing after unmount / chart destroy */
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* Stable resize handler */
  const handleResize = useCallback(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
      });
    }
  }, []);

  /* Close dropdown when clicking outside */
  useEffect(() => {
    if (!toolMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setToolMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [toolMenuOpen]);

  /* Clear AI overlays */
  const clearAIDrawings = useCallback(() => {
    // Cancel pending analysis timer
    if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
    if (chartRef.current) {
      for (const series of aiSeriesRefs.current) {
        try { chartRef.current.removeSeries(series); } catch { /* already removed */ }
      }
    }
    aiSeriesRefs.current = [];
    setAiDrawn(false);
    setAiAnalyzing(false);
    setAiResult(null);
  }, []);

  /* Toggle a tool selection */
  const toggleTool = useCallback((key: AIToolKey) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /* AI Auto-Draw: compute TA and overlay selected tools */
  const handleAIDraw = useCallback(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || candles.length < MIN_CANDLES_FOR_AI || selectedTools.size === 0) return;

    setAiAnalyzing(true);

    // Cancel any pending timer from a previous invocation
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);

    // Brief delay for UX. When wired to a live API you can replace this
    // setTimeout with an async fetch and remove the timer ref guard.
    aiTimerRef.current = setTimeout(() => {
      aiTimerRef.current = null;
      // Guard: chart may have been destroyed while waiting
      if (!chartRef.current) { setAiAnalyzing(false); return; }

      // Remove previous AI drawings
      for (const series of aiSeriesRefs.current) {
        try { chartRef.current.removeSeries(series); } catch { /* noop */ }
      }
      aiSeriesRefs.current = [];

      const chartNow = chartRef.current;
      const closes = candles.map((c) => c.close);
      const analysis = runAIAnalysis(candles);

      // ---------- EMA Crossover ----------
      if (selectedTools.has('ema')) {
        const ema9Data = calcEMA(closes, 9);
        const ema9Series = chartNow.addSeries(LineSeries, {
          color: '#facc15',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'EMA 9',
        });
        ema9Series.setData(
          candles.map((c, i) => ({ time: c.time, value: ema9Data[i] })),
        );
        aiSeriesRefs.current.push(ema9Series);

        const ema21Data = calcEMA(closes, 21);
        const ema21Series = chartNow.addSeries(LineSeries, {
          color: '#22d3ee',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'EMA 21',
        });
        ema21Series.setData(
          candles.map((c, i) => ({ time: c.time, value: ema21Data[i] })),
        );
        aiSeriesRefs.current.push(ema21Series);
      }

      // ---------- Support / Resistance ----------
      if (selectedTools.has('supportResistance')) {
        const supportSeries = chartNow.addSeries(LineSeries, {
          color: '#22c55e',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'Support',
        });
        supportSeries.setData(
          candles.map((c) => ({ time: c.time, value: analysis.support })),
        );
        aiSeriesRefs.current.push(supportSeries);

        const resistanceSeries = chartNow.addSeries(LineSeries, {
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'Resistance',
        });
        resistanceSeries.setData(
          candles.map((c) => ({ time: c.time, value: analysis.resistance })),
        );
        aiSeriesRefs.current.push(resistanceSeries);
      }

      // ---------- Long Position ----------
      if (selectedTools.has('longPosition')) {
        // Entry line — white solid
        const entryLong = chartNow.addSeries(LineSeries, {
          color: '#a1a1aa',
          lineWidth: 1,
          lineStyle: 0,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'L Entry',
        });
        entryLong.setData(candles.map((c) => ({ time: c.time, value: analysis.entryPrice })));
        aiSeriesRefs.current.push(entryLong);

        // Take profit line — green
        const tpLong = chartNow.addSeries(LineSeries, {
          color: '#22c55e',
          lineWidth: 2,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'L TP',
        });
        tpLong.setData(candles.map((c) => ({ time: c.time, value: analysis.longTP })));
        aiSeriesRefs.current.push(tpLong);

        // Stop loss line — red
        const slLong = chartNow.addSeries(LineSeries, {
          color: '#ef4444',
          lineWidth: 2,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'L SL',
        });
        slLong.setData(candles.map((c) => ({ time: c.time, value: analysis.longSL })));
        aiSeriesRefs.current.push(slLong);
      }

      // ---------- Short Position ----------
      if (selectedTools.has('shortPosition')) {
        // Entry line — white solid
        const entryShort = chartNow.addSeries(LineSeries, {
          color: '#a1a1aa',
          lineWidth: 1,
          lineStyle: 0,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'S Entry',
        });
        entryShort.setData(candles.map((c) => ({ time: c.time, value: analysis.entryPrice })));
        aiSeriesRefs.current.push(entryShort);

        // Take profit line — green
        const tpShort = chartNow.addSeries(LineSeries, {
          color: '#22c55e',
          lineWidth: 2,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'S TP',
        });
        tpShort.setData(candles.map((c) => ({ time: c.time, value: analysis.shortTP })));
        aiSeriesRefs.current.push(tpShort);

        // Stop loss line — red
        const slShort = chartNow.addSeries(LineSeries, {
          color: '#ef4444',
          lineWidth: 2,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: 'S SL',
        });
        slShort.setData(candles.map((c) => ({ time: c.time, value: analysis.shortSL })));
        aiSeriesRefs.current.push(slShort);
      }

      setAiResult(analysis);
      setAiDrawn(true);
      setAiAnalyzing(false);
    }, 800);
  }, [selectedTools]);

  /* Create / recreate chart when symbol or interval changes */
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clean previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 420,
      layout: {
        background: { type: ColorType.Solid, color: '#09090b' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#1e1e22' },
        horzLines: { color: '#1e1e22' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: '#27272a',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    /* ---- Data source: live props → mock fallback ---- */
    const useLive = !!liveCandles && liveCandles.length > 0;
    const candles = useLive ? liveCandles : generateMockCandles(200, interval);
    const volume  = useLive && liveVolume ? liveVolume : generateMockVolume(candles);

    candleSeries.setData(candles);
    volumeSeries.setData(volume);
    candlesRef.current = candles;

    chart.timeScale().fitContent();

    /* Crosshair move → hover price */
    chart.subscribeCrosshairMove((param) => {
      if (!param || !param.time) {
        setCrosshairPrice(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
      if (data) setCrosshairPrice(data.close);
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    /* Notify parent so it can push incremental updates */
    onSeriesReady?.(candleSeries, volumeSeries);

    window.addEventListener('resize', handleResize);

    /* Mock-only: simulate a live tick every 2 s.
       When `liveCandles` are supplied this timer is skipped — the parent
       is responsible for calling `candleSeries.update()` directly. */
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    if (!useLive) {
      tickInterval = setInterval(() => {
        const last = candles[candles.length - 1];
        if (!last) return;
        const newClose = last.close + (Math.random() - 0.48) * 80;
        const updated: CandlestickData<Time> = {
          ...last,
          close: newClose,
          high: Math.max(last.high, newClose),
          low: Math.min(last.low, newClose),
        };
        candles[candles.length - 1] = updated;
        candlesRef.current = candles;
        candleSeries.update(updated);
      }, 2000);
    }

    return () => {
      if (tickInterval) clearInterval(tickInterval);
      if (aiTimerRef.current) { clearTimeout(aiTimerRef.current); aiTimerRef.current = null; }
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      // Reset AI state when chart is recreated
      aiSeriesRefs.current = [];
      setAiDrawn(false);
      setAiAnalyzing(false);
      setAiResult(null);
    };
    // liveCandles / liveVolume intentionally excluded — parent pushes updates
    // via onSeriesReady rather than re-rendering the entire chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, handleResize]);

  /* When parent supplies new full candle snapshots, update internal ref +
     series without recreating the chart (avoids flicker). */
  useEffect(() => {
    if (!liveCandles || liveCandles.length === 0) return;
    candlesRef.current = liveCandles;
    if (candleSeriesRef.current) candleSeriesRef.current.setData(liveCandles);
    if (volumeSeriesRef.current && liveVolume) volumeSeriesRef.current.setData(liveVolume);
  }, [liveCandles, liveVolume]);

  const signalColor = aiResult
    ? aiResult.signal.includes('BUY')
      ? 'text-green-400'
      : aiResult.signal.includes('SELL')
        ? 'text-red-400'
        : 'text-amber-400'
    : '';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <span className="text-white font-semibold text-lg">{symbol}</span>
          {crosshairPrice !== null && (
            <span className="text-zinc-400 text-sm tabular-nums">
              ${crosshairPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => onIntervalChange(iv)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  interval === iv
                    ? 'bg-blue-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
          <div className="w-px h-5 bg-zinc-700" />
          {/* AI Tool Selector */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center gap-1">
              {!aiDrawn ? (
                <>
                  <button
                    onClick={handleAIDraw}
                    disabled={aiAnalyzing || selectedTools.size === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-60 shadow-lg shadow-purple-600/20"
                  >
                    {aiAnalyzing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {aiAnalyzing ? 'Analyzing...' : `Draw (${selectedTools.size})`}
                  </button>
                  <button
                    onClick={() => setToolMenuOpen((v) => !v)}
                    className="flex items-center px-1.5 py-1.5 rounded-r-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 transition-all shadow-lg shadow-purple-600/20 border-l border-blue-500/40"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${toolMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                </>
              ) : (
                <button
                  onClick={clearAIDrawings}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear AI
                </button>
              )}
            </div>

            {/* Tool selection dropdown */}
            {toolMenuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
                <div className="px-3 py-2 border-b border-zinc-800">
                  <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">AI Tools</span>
                </div>
                {AI_TOOLS.map((tool) => {
                  const isSelected = selectedTools.has(tool.key);
                  return (
                    <button
                      key={tool.key}
                      onClick={() => toggleTool(tool.key)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-800/70 transition-colors"
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'border-purple-500 bg-purple-600'
                            : 'border-zinc-600 bg-zinc-800'
                        }`}
                      >
                        {isSelected && (
                          <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 12" fill="none">
                            <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {tool.key === 'longPosition' && <TrendingUp className="w-3 h-3 text-green-400" />}
                          {tool.key === 'shortPosition' && <TrendingDown className="w-3 h-3 text-red-400" />}
                          <span className="text-xs font-medium text-zinc-200">{tool.label}</span>
                        </div>
                        <span className="text-[10px] text-zinc-500">{tool.description}</span>
                      </div>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tool.color }} />
                    </button>
                  );
                })}
                <div className="px-3 py-2 border-t border-zinc-800 flex justify-between">
                  <button
                    onClick={() => setSelectedTools(new Set(AI_TOOLS.map((t) => t.key)))}
                    className="text-[10px] text-purple-400 hover:text-purple-300 font-medium"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setSelectedTools(new Set())}
                    className="text-[10px] text-zinc-500 hover:text-zinc-400 font-medium"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Analysis Panel */}
      {aiResult && (
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
          <div className="flex items-start gap-6 flex-wrap">
            {/* Signal badge */}
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-xs text-zinc-400">AI Signal:</span>
              <span className={`text-sm font-bold ${signalColor}`}>{aiResult.signal}</span>
              <span className="text-xs text-zinc-500">({aiResult.confidence}% confidence)</span>
            </div>

            {/* Indicators */}
            <div className="flex items-center gap-4 text-xs flex-wrap">
              {selectedTools.has('ema') && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 rounded bg-yellow-400 inline-block" />
                    <span className="text-zinc-400">EMA 9:</span>
                    <span className="text-white tabular-nums">${aiResult.ema9Last.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 rounded bg-cyan-400 inline-block" />
                    <span className="text-zinc-400">EMA 21:</span>
                    <span className="text-white tabular-nums">${aiResult.ema21Last.toFixed(2)}</span>
                  </div>
                </>
              )}
              <div>
                <span className="text-zinc-400">RSI:</span>{' '}
                <span className={`font-medium tabular-nums ${aiResult.rsiLast > 70 ? 'text-red-400' : aiResult.rsiLast < 30 ? 'text-green-400' : 'text-white'}`}>
                  {aiResult.rsiLast.toFixed(1)}
                </span>
              </div>
              {selectedTools.has('supportResistance') && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 rounded bg-green-500 inline-block" />
                    <span className="text-zinc-400">S:</span>
                    <span className="text-green-400 tabular-nums">${aiResult.support.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-0.5 rounded bg-red-500 inline-block" />
                    <span className="text-zinc-400">R:</span>
                    <span className="text-red-400 tabular-nums">${aiResult.resistance.toFixed(2)}</span>
                  </div>
                </>
              )}
              {selectedTools.has('longPosition') && (
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 text-green-400" />
                  <span className="text-zinc-400">Long TP:</span>
                  <span className="text-green-400 tabular-nums">
                    ${aiResult.longTP.toFixed(2)}
                  </span>
                  <span className="text-zinc-500">|</span>
                  <span className="text-zinc-400">SL:</span>
                  <span className="text-red-400 tabular-nums">${aiResult.longSL.toFixed(2)}</span>
                </div>
              )}
              {selectedTools.has('shortPosition') && (
                <div className="flex items-center gap-1.5">
                  <TrendingDown className="w-3 h-3 text-red-400" />
                  <span className="text-zinc-400">Short TP:</span>
                  <span className="text-green-400 tabular-nums">
                    ${aiResult.shortTP.toFixed(2)}
                  </span>
                  <span className="text-zinc-500">|</span>
                  <span className="text-zinc-400">SL:</span>
                  <span className="text-red-400 tabular-nums">${aiResult.shortSL.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Reasons */}
          <div className="mt-2 flex flex-wrap gap-2">
            {aiResult.reasons.map((reason, i) => (
              <span
                key={i}
                className="px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 text-[11px]"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Chart canvas */}
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
