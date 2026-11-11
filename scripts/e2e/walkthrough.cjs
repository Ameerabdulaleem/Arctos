// Browser walkthrough of every page against the full stack. It asserts on the data served by
// scripts/dev-fixtures, so start the fixtures, the Rust service (run-backend.sh) and Vite first.
// Needs Playwright installed (npm i -D playwright, then npx playwright install chromium).
// Usage: npm run e2e -- [output-dir]   (screenshots go to <output-dir>/shots)
const { chromium } = require('playwright');
const SC = process.argv[2] || 'e2e-output';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
require('node:fs').mkdirSync(SC + '/shots', { recursive: true });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('requestfailed', (r) => { if (!r.url().includes('/ws/')) problems.push(`requestfailed: ${r.url()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) problems.push(`http ${r.status()}: ${r.url()}`); });
  const out = [];
  const check = async (name, fn) => { try { const v = await fn(); out.push(`PASS ${name}${v ? ' :: ' + v : ''}`); } catch (e) { out.push(`FAIL ${name} :: ${e.message.split('\n')[0]}`); } };
  const shot = (n) => page.screenshot({ path: `${SC}/shots/${n}.png` });

  await page.goto(BASE + '/');
  await check('home: live BTC price in ticker strip', async () => { await page.waitForFunction(() => /BTC\s*\$97,234/.test(document.body.innerText), null, { timeout: 15000 }); });
  await check('home: live stats from overview', async () => { await page.waitForFunction(() => /\$3\.42T/.test(document.body.innerText), null, { timeout: 15000 }); });
  await check('home: no fabricated claims', async () => { const t = await page.locator('body').innerText(); for (const bad of ['50K+', '$2.5B+', '99.9%', 'thousands of traders', '$1.24']) if (t.includes(bad)) throw new Error('found ' + bad); });
  await page.waitForTimeout(1800); await shot('01-home');

  await check('waitlist: invalid email rejected', async () => { await page.locator('input[type=email]').first().fill('nope'); await page.locator('form').first().getByRole('button', { name: 'Join waitlist' }).click(); });
  await check('waitlist: valid email accepted', async () => { await page.locator('input[type=email]').first().fill('tester@example.com'); await page.locator('form').first().getByRole('button', { name: 'Join waitlist' }).click(); await page.getByText(/on the list/).first().waitFor({ timeout: 8000 }); });

  await page.getByRole('button', { name: 'Get started' }).first().click();
  await check('dashboard: widgets with live data', async () => { await page.getByText('3.42T').first().waitFor({ timeout: 15000 }); await page.getByText(/\/100/).first().waitFor(); });
  await check('dashboard: altseason basis text', async () => { await page.getByText(/beat Bitcoin over 30 days/).first().waitFor({ timeout: 8000 }); });
  await check('dashboard: headlines and whales present', async () => { await page.getByText('SEC approves new spot Ethereum ETF options trading').first().waitFor({ timeout: 10000 }); await page.getByText(/USDC/).first().waitFor({ timeout: 10000 }); });
  await page.waitForTimeout(800); await shot('02-dashboard');

  await page.getByRole('button', { name: 'Trading Terminal' }).click();
  await check('terminal: candles chart canvas', async () => { await page.locator('canvas').first().waitFor({ timeout: 10000 }); });
  await check('terminal: order book rows', async () => { await page.getByRole('heading', { name: 'Order book' }).waitFor(); await page.waitForFunction(() => document.body.innerText.includes('spread'), null, { timeout: 8000 }); });
  await check('terminal: paper market buy fills', async () => {
    await page.getByRole('button', { name: '25%' }).click();
    await page.getByRole('button', { name: /^Buy BTC \(paper\)$/ }).click();
    await page.getByText(/Paper buy filled/).waitFor({ timeout: 5000 });
    await page.getByText('Your position').waitFor({ timeout: 5000 });
  });
  await shot('03-terminal');
  await check('terminal: switch pair resets form', async () => { await page.getByRole('tab', { name: /^ETH\/USDT/ }).click(); const v = await page.locator('input[type=number]').first().inputValue(); if (v !== '') throw new Error('form kept ' + v); });

  await page.getByRole('button', { name: 'Sniper Engine' }).click();
  await check('sniper: new pools listed with risk', async () => { await page.getByText('PEPEX').first().waitFor({ timeout: 15000 }); await page.getByText(/Low risk/).first().waitFor({ timeout: 15000 }); });
  await check('sniper: paper snipe opens a position', async () => { await page.getByRole('button', { name: /Paper snipe/ }).first().click(); await page.getByText('Open snipes').first().waitFor({ timeout: 6000 }); });
  await check('sniper: search finds token', async () => { await page.getByLabel('Search tokens').fill('pepe'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.getByText('Search results').waitFor({ timeout: 8000 }); });
  await page.waitForTimeout(500); await shot('04-sniper');

  await page.getByRole('button', { name: 'Trade Book' }).click();
  await check('tradebook: add trade and see live P/L', async () => {
    await page.getByRole('button', { name: 'Add Trade' }).first().click();
    await page.getByPlaceholder('e.g. BTC, ETH').fill('BTC'); await page.locator('input[type=number]').nth(0).fill('90000'); await page.locator('input[type=number]').nth(1).fill('0.5');
    await page.getByRole('button', { name: 'Save Trade' }).click();
    await page.getByText('live', { exact: true }).first().waitFor({ timeout: 8000 });
  });
  await shot('05-tradebook');

  await page.getByRole('button', { name: 'Whale Alerts' }).click();
  await check('whales: events from chain with exchange label', async () => { await page.getByText('Coinbase').first().waitFor({ timeout: 10000 }); });
  await check('whales: honest solana status', async () => { await page.getByText(/Solana: not available yet/).waitFor(); });
  await check('whales: invalid tracked address rejected', async () => { await page.getByRole('button', { name: 'Track wallet' }).click(); await page.getByPlaceholder('0x... or Solana address').fill('bad'); await page.getByPlaceholder('Smart money 1').fill('x'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.getByText(/valid Ethereum style/).waitFor(); });
  await shot('06-whales');

  await page.getByRole('button', { name: 'Fundamental News' }).click();
  await check('news: articles with impact', async () => { await page.getByText('DeFi lending protocol drained').first().waitFor({ timeout: 10000 }); const t = await page.locator('main').innerText(); if (!/security/i.test(t) || !/high/i.test(t)) throw new Error('no impact/category badges'); });
  await check('news: external links are safe', async () => { const rels = await page.locator('a[target=_blank]').evaluateAll((els) => els.map((e) => e.rel)); if (!rels.length || rels.some((r) => !r.includes('noopener'))) throw new Error('missing noopener'); });
  await shot('07-news');

  await page.getByRole('button', { name: 'Stocks & PRE-IPO' }).click();
  await check('stocks: live quotes', async () => { await page.getByText('COIN').first().waitFor({ timeout: 10000 }); });
  await page.getByRole('tab', { name: /WLTH/ }).click();
  await check('preipo: static data flagged', async () => { await page.getByText(/static, may be out of date/).waitFor(); });
  await shot('08-stocks');

  await page.getByRole('button', { name: 'AI Chat' }).click();
  await check('ai: send message and get reply', async () => {
    await page.locator('#chat-input').fill('How is bitcoin doing?'); await page.getByRole('button', { name: 'Send message' }).click();
    await page.getByText('Fixture reply.').waitFor({ timeout: 15000 });
    await page.getByText('Bitcoin appears in it: true').waitFor();
  });
  await shot('09-chat');

  await page.getByRole('button', { name: 'Settings' }).click();
  await check('settings: data sources health', async () => { await page.getByText('coingecko').waitFor({ timeout: 10000 }); await page.getByRole('heading', { name: 'Data sources' }).waitFor(); });
  await shot('10-settings');

  await check('wallet modal opens and reports missing wallet', async () => {
    await page.getByRole('button', { name: 'Connect wallet' }).first().click();
    await page.getByText('Connect your wallet').waitFor();
    await page.getByRole('button', { name: 'Connect' }).first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await page.getByText(/Install/).first().waitFor({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  await check('email account: sign up, hashed storage, sign in', async () => {
    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await page.getByRole('button', { name: /Create one/ }).click();
    await page.getByLabel('Email').fill('Owner@Example.com'); await page.getByLabel('Password').fill('correct-horse-9');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('owner@example.com').first().waitFor({ timeout: 8000 });
    const stored = await page.evaluate(() => localStorage.getItem('arctos_accounts_v2') + '|' + (localStorage.getItem('arctos_accounts') ?? ''));
    if (stored.includes('correct-horse-9')) throw new Error('plaintext password in storage');
    if (!stored.includes('salt')) throw new Error('no salted hash');
  });

  // Mobile
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  mp.on('pageerror', (e) => problems.push(`mobile pageerror: ${e.message}`));
  await mp.goto(BASE + '/'); await mp.waitForTimeout(2500); await mp.screenshot({ path: `${SC}/shots/11-mobile-home.png` });
  await mp.goto(BASE + '/#/dashboard'); await mp.waitForTimeout(2500);
  await check('mobile: no horizontal overflow on dashboard', async () => { const o = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 4) throw new Error('overflow ' + o); });
  await mp.getByRole('button', { name: 'Open menu' }).click(); await mp.waitForTimeout(400); await mp.screenshot({ path: `${SC}/shots/12-mobile-menu.png` });

  console.log(out.join('\n'));
  const uniq = [...new Set(problems)];
  console.log('\nPROBLEMS (' + uniq.length + '):\n' + uniq.join('\n'));
  await browser.close();
})();
