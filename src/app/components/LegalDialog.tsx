import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';

export type LegalTopic = 'privacy' | 'terms' | 'risk';

const CONTENT: Record<LegalTopic, { title: string; paragraphs: string[] }> = {
  privacy: {
    title: 'Privacy',
    paragraphs: [
      'Waitlist: if you join, we store your email address so we can tell you when early access opens. We do not sell it.',
      'Wallets: when you connect a wallet, your browser shares the public address with our data service so it can look up balances on public blockchains. We do not store it and we never ask for signatures or approvals.',
      'On your device: your trade book, paper trading account, tracked wallets and sign in details stay in your browser storage. Clearing your browser data removes them.',
      'AI chat: your messages, and the portfolio facts you choose to share, are sent through our server to Anthropic to produce an answer.',
      'Servers: our hosting providers may log IP addresses for security and abuse prevention. Market data providers only see requests made by our server.',
    ],
  },
  terms: {
    title: 'Terms of use',
    paragraphs: [
      'Arctos is early access software provided as is, without warranties. Data can be delayed, incomplete or wrong, and features can change or stop working.',
      'Trading inside Arctos is paper trading. Orders are simulated against live prices and no real funds move.',
      'Arctos does not hold your funds or private keys. You are responsible for your wallets, devices and any transaction you make elsewhere.',
      'Nothing on this site is financial, investment, legal or tax advice.',
    ],
  },
  risk: {
    title: 'Risk disclosure',
    paragraphs: [
      'Crypto assets are volatile and you can lose all of the money you put in. New or low liquidity tokens are frequently scams.',
      'Risk scores and contract checks are automated and can miss problems or flag safe tokens. Whale labels cover only a small list of well known exchange wallets.',
      'Pre IPO listings link to third party platforms. Valuations are indicative, may be out of date, and offers may pay Arctos a referral fee.',
      'Only trade with money you can afford to lose and do your own research.',
    ],
  },
};

interface Props {
  topic: LegalTopic | null;
  onClose: () => void;
}

export function LegalDialog({ topic, onClose }: Props) {
  const content = topic ? CONTENT[topic] : null;
  return (
    <Dialog open={Boolean(topic)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">{content?.title}</DialogTitle>
          <p className="text-xs text-amber-300/80">Plain language summary. Have a lawyer review it before a public launch.</p>
        </DialogHeader>
        <div className="space-y-3 text-sm text-zinc-300 leading-relaxed max-h-[60vh] overflow-y-auto pr-1">
          {content?.paragraphs.map((p) => <p key={p}>{p}</p>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}
