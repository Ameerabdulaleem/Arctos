import { useState } from 'react';
import { ExternalLink, TrendingUp, Building2, DollarSign, Info } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';

/**
 * Stocks & PRE-IPO Component
 * 
 * CUSTOMIZATION GUIDE:
 * 
 * 1. TO UPDATE PROMOTIONAL LINKS:
 *    - Find the stock object in the platforms array
 *    - Update the 'link' field with your promotional URL
 *    - Example: link: 'https://your-promotional-link.com/xai'
 * 
 * 2. TO ADD NEW STOCKS:
 *    - Copy an existing stock object
 *    - Update all fields (id, name, ticker, description, imageUrl, etc.)
 *    - Add it to the stocks array of the desired platform
 * 
 * 3. TO ADD A NEW PLATFORM TAB:
 *    - Copy the wlth platform object
 *    - Update id, name, description, and stocks array
 *    - Add it to the platforms array
 * 
 * 4. TO MARK A STOCK AS "HOT":
 *    - Set isHot: true in the stock object
 * 
 * 5. TO GET NEW IMAGES:
 *    - Use Unsplash or your own image URLs
 *    - Update the imageUrl field
 */

interface PreIPOStock {
  id: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  valuation: string;
  minInvestment: string;
  sector: string;
  link: string;
  isHot?: boolean;
}

interface StocksPlatform {
  id: string;
  name: string;
  description: string;
  stocks: PreIPOStock[];
}

export function StocksPreIPO() {
  const [activeTab, setActiveTab] = useState('wlth');

  // Platform data with embedded promotional links
  // TO CUSTOMIZE: Update the 'link' field with your promotional URLs
  // TO ADD MORE STOCKS: Add new objects to the stocks array
  // TO ADD MORE PLATFORMS: Add new objects to the platforms array
  const platforms: StocksPlatform[] = [
    {
      id: 'wlth',
      name: 'WLTH.xyz',
      description: 'Access exclusive PRE-IPO opportunities from leading tech companies',
      stocks: [
        {
          id: 'xai',
          name: 'xAI',
          ticker: 'XAI',
          description: 'Elon Musk\'s AI company building advanced artificial intelligence systems to understand the universe.',
          imageUrl: 'https://images.unsplash.com/photo-1591522810896-cb5f45acb9a1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0ZWNobm9sb2d5JTIwc3RhcnR1cCUyMGludmVzdG1lbnR8ZW58MXx8fHwxNzczMjMzMDAwfDA&ixlib=rb-4.1.0&q=80&w=1080',
          valuation: '$24B',
          minInvestment: '$500',
          sector: 'Artificial Intelligence',
          link: 'https://wlth.xyz/xai', // ← Update this with your promotional link
          isHot: true,
        },
        {
          id: 'x-energy',
          name: 'X-ENERGY',
          ticker: 'XE',
          description: 'Next-generation nuclear reactor technology company developing small modular reactors for clean energy.',
          imageUrl: 'https://images.unsplash.com/photo-1572455915586-efc2816042cc?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxudWNsZWFyJTIwZW5lcmd5JTIwcmVhY3RvcnxlbnwxfHx8fDE3NzMyMzI5OTd8MA&ixlib=rb-4.1.0&q=80&w=1080',
          valuation: '$8B',
          minInvestment: '$1,000',
          sector: 'Clean Energy',
          link: 'https://wlth.xyz/x-energy', // ← Update this with your promotional link
          isHot: true,
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          ticker: 'ANTH',
          description: 'AI safety and research company behind Claude, focusing on building reliable, interpretable AI systems.',
          imageUrl: 'https://images.unsplash.com/photo-1627195477669-f1a237ab6280?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxhbnRocm9waWMlMjBhaSUyMHRlY2hub2xvZ3l8ZW58MXx8fHwxNzczMjMyOTk3fDA&ixlib=rb-4.1.0&q=80&w=1080',
          valuation: '$18B',
          minInvestment: '$750',
          sector: 'Artificial Intelligence',
          link: 'https://wlth.xyz/anthropic', // ← Update this with your promotional link
          isHot: true,
        },
        {
          id: 'spacex',
          name: 'SpaceX',
          ticker: 'SPACEX',
          description: 'Revolutionary aerospace manufacturer and space transportation company developing Starship and Starlink.',
          imageUrl: 'https://images.unsplash.com/photo-1759808418292-f65b69f3ca48?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzcGFjZSUyMGV4cGxvcmF0aW9uJTIwcm9ja2V0fGVufDF8fHx8MTc3MzE0MjMwNHww&ixlib=rb-4.1.0&q=80&w=1080',
          valuation: '$180B',
          minInvestment: '$2,500',
          sector: 'Aerospace',
          link: 'https://wlth.xyz/spacex', // ← Update this with your promotional link
        },
        {
          id: 'stripe',
          name: 'Stripe',
          ticker: 'STRIPE',
          description: 'Leading online payment processing platform powering millions of businesses worldwide.',
          imageUrl: 'https://images.unsplash.com/photo-1762279389020-eeeb69c25813?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxmaW5hbmNpYWwlMjBncm93dGglMjBjaGFydHxlbnwxfHx8fDE3NzMxNjIxODB8MA&ixlib=rb-4.1.0&q=80&w=1080',
          valuation: '$65B',
          minInvestment: '$1,500',
          sector: 'FinTech',
          link: 'https://wlth.xyz/stripe', // ← Update this with your promotional link
        },
        {
          id: 'databricks',
          name: 'Databricks',
          ticker: 'DBRK',
          description: 'Unified data analytics platform combining data warehousing and AI capabilities for enterprises.',
          imageUrl: 'https://images.unsplash.com/photo-1651341050677-24dba59ce0fd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzdG9jayUyMG1hcmtldCUyMHRyYWRpbmd8ZW58MXx8fHwxNzczMjIwNzgxfDA&ixlib=rb-4.1.0&q=80&w=1080',
          valuation: '$43B',
          minInvestment: '$1,000',
          sector: 'Data & Analytics',
          link: 'https://wlth.xyz/databricks', // ← Update this with your promotional link
        },
      ],
    },
    // Placeholder for future platforms
    {
      id: 'platform2',
      name: 'Coming Soon',
      description: 'More PRE-IPO investment platforms coming soon',
      stocks: [],
    },
  ];

  const activePlatform = platforms.find(p => p.id === activeTab) || platforms[0];

  const handleStockClick = (link: string) => {
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Stocks & PRE-IPO</h1>
        <p className="text-zinc-400">
          Invest in high-growth private companies before they go public
        </p>
      </div>

      {/* Platform Tabs */}
      <div className="border-b border-zinc-800 mb-8">
        <div className="flex gap-6 overflow-x-auto">
          {platforms.map((platform) => (
            <button
              key={platform.id}
              onClick={() => setActiveTab(platform.id)}
              className={`pb-4 px-2 border-b-2 transition-colors whitespace-nowrap ${
                activeTab === platform.id
                  ? 'border-blue-500 text-white'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                <span className="font-medium">{platform.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Platform Info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 mb-8">
        <div className="flex items-start gap-4">
          <div className="bg-blue-600/10 p-3 rounded-lg">
            <Info className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">{activePlatform.name}</h2>
            <p className="text-zinc-400">{activePlatform.description}</p>
            {activePlatform.stocks.length === 0 && (
              <p className="text-zinc-500 mt-4 italic">
                This platform will be available soon. Stay tuned for more PRE-IPO opportunities!
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Stock Cards Grid */}
      {activePlatform.stocks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {activePlatform.stocks.map((stock) => (
            <div
              key={stock.id}
              onClick={() => handleStockClick(stock.link)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden hover:border-blue-500 transition-all cursor-pointer group"
            >
              {/* Stock Image */}
              <div className="relative h-48 overflow-hidden bg-zinc-800">
                <ImageWithFallback
                  src={stock.imageUrl}
                  alt={stock.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {stock.isHot && (
                  <div className="absolute top-4 right-4">
                    <div className="bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      HOT
                    </div>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent opacity-60" />
              </div>

              {/* Stock Info */}
              <div className="p-6">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-xl font-bold mb-1">{stock.name}</h3>
                    <span className="text-sm text-zinc-500">{stock.ticker}</span>
                  </div>
                  <ExternalLink className="w-5 h-5 text-zinc-400 group-hover:text-blue-500 transition-colors" />
                </div>

                <p className="text-zinc-400 text-sm mb-4 line-clamp-2">
                  {stock.description}
                </p>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Sector</span>
                    <span className="text-white font-medium">{stock.sector}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Valuation</span>
                    <span className="text-green-500 font-bold">{stock.valuation}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Min. Investment</span>
                    <span className="text-white font-medium">{stock.minInvestment}</span>
                  </div>
                </div>

                <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors flex items-center justify-center gap-2 group-hover:gap-3">
                  <DollarSign className="w-4 h-4" />
                  Invest Now
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Disclaimer */}
      <div className="mt-12 bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-zinc-400 mb-2">Important Disclaimer</h3>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Investing in PRE-IPO stocks involves substantial risk and may not be suitable for all investors. 
          Past performance is not indicative of future results. Please conduct your own research and consult 
          with a financial advisor before making any investment decisions. The links provided are promotional 
          and may result in compensation to the platform. Minimum investments and valuations are subject to change.
        </p>
      </div>
    </div>
  );
}
