import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';

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

/* ------------------------------------------------------------------ */
/*  Volume bar generator                                               */
/* ------------------------------------------------------------------ */

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
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);

  /* Stable resize handler */
  const handleResize = useCallback(() => {
    if (chartRef.current && chartContainerRef.current) {
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
      });
    }
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
      candleSeries.update(updated);
    }, 2000);

    return () => {
      clearInterval(tickInterval);
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [symbol, interval, handleResize]);

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
      </div>

      {/* Chart canvas */}
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
