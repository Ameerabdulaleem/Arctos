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
import { Sparkles, Loader2, X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ChartInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

interface TradingViewChartProps {
  symbol: string;
  interval: ChartInterval;
  onIntervalChange: (interval: ChartInterval) => void;
}

/* ------------------------------------------------------------------ */
/*  Technical Analysis Utilities                                       */
/* ------------------------------------------------------------------ */

function calcEMA(data: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  let prev = data[0];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      prev = data.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
      ema.push(prev);
    } else {
      prev = (data[i] - prev) * multiplier + prev;
      ema.push(prev);
    }
  }
  return ema;
}

function calcRSI(closes: number[], period = 14): number[] {
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
    rsi.push(100 - 100 / (1 + rs));
  }
  return rsi;
}

function findSupportResistance(candles: CandlestickData<Time>[]): { support: number; resistance: number } {
  if (candles.length < 20) {
    return { support: candles[0]?.low ?? 0, resistance: candles[0]?.high ?? 0 };
  }
  const recent = candles.slice(-50);
  const lows = recent.map((c) => c.low).sort((a, b) => a - b);
  const highs = recent.map((c) => c.high).sort((a, b) => b - a);

  // Cluster the lowest lows and highest highs
  const support = lows.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const resistance = highs.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
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

  return { signal, confidence, reasons, ema9Last, ema21Last, rsiLast, support, resistance };
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

export default function TradingViewChart({ symbol, interval, onIntervalChange }: TradingViewChartProps) {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const aiSeriesRefs = useRef<any[]>([]);

  /* Stable resize handler */
  const handleResize = useCallback(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
      });
    }
  }, []);

  /* Clear AI overlays */
  const clearAIDrawings = useCallback(() => {
    if (chartRef.current) {
      for (const series of aiSeriesRefs.current) {
        try { chartRef.current.removeSeries(series); } catch { /* already removed */ }
      }
    }
    aiSeriesRefs.current = [];
    setAiDrawn(false);
    setAiResult(null);
  }, []);

  /* AI Auto-Draw: compute TA and overlay EMA, RSI zones, S/R lines */
  const handleAIDraw = useCallback(() => {
    const chart = chartRef.current;
    const candles = candlesRef.current;
    if (!chart || candles.length < 30) return;

    setAiAnalyzing(true);

    // Simulate brief analysis delay for UX
    setTimeout(() => {
      // Remove previous AI drawings
      for (const series of aiSeriesRefs.current) {
        try { chart.removeSeries(series); } catch { /* noop */ }
      }
      aiSeriesRefs.current = [];

      const closes = candles.map((c) => c.close);
      const analysis = runAIAnalysis(candles);

      // 1. EMA 9 (fast) — yellow
      const ema9Data = calcEMA(closes, 9);
      const ema9Series = chart.addSeries(LineSeries, {
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

      // 2. EMA 21 (slow) — cyan
      const ema21Data = calcEMA(closes, 21);
      const ema21Series = chart.addSeries(LineSeries, {
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

      // 3. Support line — green dashed
      const supportSeries = chart.addSeries(LineSeries, {
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2, // dashed
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'Support',
      });
      supportSeries.setData(
        candles.map((c) => ({ time: c.time, value: analysis.support })),
      );
      aiSeriesRefs.current.push(supportSeries);

      // 4. Resistance line — red dashed
      const resistanceSeries = chart.addSeries(LineSeries, {
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

      setAiResult(analysis);
      setAiDrawn(true);
      setAiAnalyzing(false);
    }, 800);
  }, []);

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

    const candles = generateMockCandles(200, interval);
    candleSeries.setData(candles);
    volumeSeries.setData(generateMockVolume(candles));
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

    window.addEventListener('resize', handleResize);

    /* Simulate live tick every 2s */
    const tickInterval = setInterval(() => {
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

    return () => {
      clearInterval(tickInterval);
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      // Reset AI state when chart is recreated
      aiSeriesRefs.current = [];
      setAiDrawn(false);
      setAiResult(null);
    };
  }, [symbol, interval, handleResize]);

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
          {!aiDrawn ? (
            <button
              onClick={handleAIDraw}
              disabled={aiAnalyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-60 shadow-lg shadow-purple-600/20"
            >
              {aiAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              {aiAnalyzing ? 'Analyzing...' : 'AI Auto-Draw'}
            </button>
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
            <div className="flex items-center gap-4 text-xs">
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
              <div>
                <span className="text-zinc-400">RSI:</span>{' '}
                <span className={`font-medium tabular-nums ${aiResult.rsiLast > 70 ? 'text-red-400' : aiResult.rsiLast < 30 ? 'text-green-400' : 'text-white'}`}>
                  {aiResult.rsiLast.toFixed(1)}
                </span>
              </div>
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
