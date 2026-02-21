import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Coins, Landmark, Paintbrush } from 'lucide-react';
import { DashboardAssets } from '../services/dashboardSyncService';

interface AssetTabsProps {
  assets: DashboardAssets;
}

type AssetTab = 'tokens' | 'defi' | 'nfts';

const tabLabels: { key: AssetTab; label: string; icon: React.ReactNode }[] = [
  { key: 'tokens', label: 'Tokens', icon: <Coins className="w-4 h-4" /> },
  { key: 'defi', label: 'DeFi', icon: <Landmark className="w-4 h-4" /> },
  { key: 'nfts', label: 'NFTs', icon: <Paintbrush className="w-4 h-4" /> }
];

export function AssetTabs({ assets }: AssetTabsProps) {
  const [activeTab, setActiveTab] = useState<AssetTab>('tokens');

  const rows = useMemo(() => assets[activeTab], [activeTab, assets]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {tabLabels.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
              activeTab === tab.key
                ? 'bg-zinc-800 border-zinc-700 text-white'
                : 'bg-transparent border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {rows.map((asset) => {
          const positive = asset.change24h >= 0;
          return (
            <div key={`${asset.chain}-${asset.symbol}-${asset.name}`} className="flex items-center justify-between p-4 bg-zinc-800/70 rounded-lg border border-zinc-800">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white font-medium">{asset.name}</p>
                  <span className="text-[11px] bg-zinc-700 text-zinc-200 px-2 py-0.5 rounded">{asset.chain}</span>
                </div>
                <p className="text-zinc-400 text-sm mt-1">
                  {asset.amount} {asset.symbol}
                </p>
              </div>

              <div className="text-right">
                <p className="text-white font-semibold">{asset.value}</p>
                <div className={`mt-1 inline-flex items-center gap-1 text-sm ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {positive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  {positive ? '+' : ''}
                  {asset.change24h.toFixed(2)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
