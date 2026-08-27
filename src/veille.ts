import { chromium, type Page } from 'playwright';
import nodemailer from 'nodemailer';
import { readFile, writeFile } from 'node:fs/promises';

const URL = process.env.SEARCH_URL ?? 'https://recrutement.education.gouv.fr/recrutement/offres?term=lettres&Region__c=11';
const STATE_FILE = process.env.STATE_FILE ?? 'data/seen.json';
const keywords = ['lettres', 'français'];

type Offer = { id: string; title: string; location: string; url: string; text: string };

async function textOf(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\\s+/g, ' ').trim();
}

async function scrape(): Promise<Offer[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(2_000);

    const offers = await page.locator('a').evaluateAll((anchors) => anchors.map((anchor) => {
      const a = anchor as HTMLAnchorElement;
      const text = (a.innerText || a.textContent || '').replace(/\\s+/g, ' ').trim();
      return { title: text, url: a.href };
    }).filter((item) => item.title && item.url));

    return offers
      .filter((item) => keywords.some((keyword) => item.title.toLocaleLowerCase('fr-FR').includes(keyword)))
      .map((item) => ({
        id: item.url,
        title: item.title,
        location: '',
        url: item.url,
        text: item.title,
      }));
  } finally {
    await browser.close();
  }
}

async function loadSeen(): Promise<Set<string>> {
  try {
    const content = await readFile(STATE_FILE, 'utf8');
    return new Set(JSON.parse(content) as string[]);
  } catch {
    return new Set();
  }
}

async function saveSeen(seen: Set<string>): Promise<void> {
  await writeFile(STATE_FILE, `${JSON.stringify([...seen].slice(-2_000), null, 2)}\\n`);
}

async function notify(offers: Offer[]): Promise<void> {
  if (offers.length === 0) return;
  const { GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !ALERT_TO) {
    throw new Error('Missing GMAIL_USER, GMAIL_APP_PASSWORD or ALERT_TO secrets');
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  const html = offers.map((offer) => `<p><strong>${escapeHtml(offer.title)}</strong><br><a href="${offer.url}">${offer.url}</a></p>`).join('');
  await transporter.sendMail({
    from: GMAIL_USER,
    to: ALERT_TO,
    subject: `Nouvelles offres Lilmac (${offers.length})`,
    text: offers.map((offer) => `${offer.title}\\n${offer.url}`).join('\\n\\n'),
    html,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

const found = await scrape();
const seen = await loadSeen();
const fresh = found.filter((offer) => !seen.has(offer.id));
for (const offer of found) seen.add(offer.id);
await saveSeen(seen);
await notify(fresh);
console.log(`Offres trouvées: ${found.length}; nouvelles: ${fresh.length}`);
