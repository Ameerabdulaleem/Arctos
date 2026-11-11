// Curated PRE-IPO listings. There is no free live price source for private companies, so this is
// static content you maintain by hand. Update `valuation` and `valuationNote` when you refresh a card,
// and replace the links with your own referral links.

export interface PreIpoListing {
  id: string;
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  /** Last valuation you published, shown with the note below. Leave undefined to hide the row. */
  valuation?: string;
  valuationNote?: string;
  minInvestment: string;
  sector: string;
  link: string;
  isHot?: boolean;
}

export interface PreIpoPlatform {
  id: string;
  name: string;
  description: string;
  listings: PreIpoListing[];
}

const NOTE = 'As listed. May be out of date, check the platform.';

export const PRE_IPO_PLATFORMS: PreIpoPlatform[] = [
  {
    id: 'wlth',
    name: 'WLTH.xyz',
    description: 'Access exclusive PRE-IPO opportunities from leading tech companies',
    listings: [
      {
        id: 'xai', name: 'xAI', ticker: 'XAI',
        description: "Elon Musk's AI company building advanced artificial intelligence systems to understand the universe.",
        imageUrl: 'https://images.unsplash.com/photo-1591522810896-cb5f45acb9a1?auto=format&fit=crop&w=1080&q=80',
        valuation: '$24B', valuationNote: NOTE, minInvestment: '$500', sector: 'Artificial Intelligence', link: 'https://wlth.xyz/xai', isHot: true,
      },
      {
        id: 'x-energy', name: 'X-ENERGY', ticker: 'XE',
        description: 'Next generation nuclear reactor technology company developing small modular reactors for clean energy.',
        imageUrl: 'https://images.unsplash.com/photo-1572455915586-efc2816042cc?auto=format&fit=crop&w=1080&q=80',
        valuation: '$8B', valuationNote: NOTE, minInvestment: '$1,000', sector: 'Clean Energy', link: 'https://wlth.xyz/x-energy', isHot: true,
      },
      {
        id: 'anthropic', name: 'Anthropic', ticker: 'ANTH',
        description: 'AI safety and research company behind Claude, focusing on building reliable, interpretable AI systems.',
        imageUrl: 'https://images.unsplash.com/photo-1627195477669-f1a237ab6280?auto=format&fit=crop&w=1080&q=80',
        valuation: '$18B', valuationNote: NOTE, minInvestment: '$750', sector: 'Artificial Intelligence', link: 'https://wlth.xyz/anthropic', isHot: true,
      },
      {
        id: 'spacex', name: 'SpaceX', ticker: 'SPACEX',
        description: 'Aerospace manufacturer and space transportation company developing Starship and Starlink.',
        imageUrl: 'https://images.unsplash.com/photo-1759808418292-f65b69f3ca48?auto=format&fit=crop&w=1080&q=80',
        valuation: '$180B', valuationNote: NOTE, minInvestment: '$2,500', sector: 'Aerospace', link: 'https://wlth.xyz/spacex',
      },
      {
        id: 'stripe', name: 'Stripe', ticker: 'STRIPE',
        description: 'Online payment processing platform powering millions of businesses worldwide.',
        imageUrl: 'https://images.unsplash.com/photo-1762279389020-eeeb69c25813?auto=format&fit=crop&w=1080&q=80',
        valuation: '$65B', valuationNote: NOTE, minInvestment: '$1,500', sector: 'FinTech', link: 'https://wlth.xyz/stripe',
      },
      {
        id: 'databricks', name: 'Databricks', ticker: 'DBRK',
        description: 'Unified data analytics platform combining data warehousing and AI capabilities for enterprises.',
        imageUrl: 'https://images.unsplash.com/photo-1651341050677-24dba59ce0fd?auto=format&fit=crop&w=1080&q=80',
        valuation: '$43B', valuationNote: NOTE, minInvestment: '$1,000', sector: 'Data and Analytics', link: 'https://wlth.xyz/databricks',
      },
    ],
  },
];
