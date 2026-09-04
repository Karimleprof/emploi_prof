import { chromium } from 'playwright';
import nodemailer from 'nodemailer';
import { readFile, writeFile } from 'node:fs/promises';

const URL = process.env.SEARCH_URL ?? 'https://recrutement.education.gouv.fr/recrutement/offres?term=lettres&Region__c=11';
const STATE_FILE = process.env.STATE_FILE ?? 'data/seen.json';
const KEYWORDS = ['lettres', 'français'];

type Offer = { key: string; title: string; academy: string; date: string; location: string; url: string };

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

async function scrape(): Promise<Offer[]> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(6_000);

    const cards = await page.locator('article.fr-card').evaluateAll((articles) =>
      (articles as HTMLElement[]).map((article) => {
        const lines = article.innerText
          .split(/\n+/)
          .map((line) => line.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        return { lines, full: lines.join(' | ') };
      }),
    );

    const seenText = cards.map((card) => card.full).join(' ');
    const result: Offer[] = [];
    for (const card of cards) {
      if (!KEYWORDS.some((keyword) => card.full.toLocaleLowerCase('fr-FR').includes(keyword))) continue;
      const title = card.lines[0] ?? 'Offre sans titre';
      const academyLine = card.lines.find((line) => /académie/i.test(line));
      const dateMatch = card.full.match(/Publié le\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
      const date = dateMatch?.[1] ?? '';
      result.push({
        key: normalize(`${title} | ${date}`).toLocaleLowerCase('fr-FR'),
        title,
        academy: academyLine ? academyLine.replace(/^Académie\s+(de\s+)?/i, '') : '',
        date,
        location: academyLine ?? '',
        url: URL,
      });
    }
    if (result.length === 0) {
      console.error('Aucun résultat exploitable. Texte de la page:', seenText.slice(0, 1_000));
    }
    return result;
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
  await writeFile(STATE_FILE, `${JSON.stringify([...seen].slice(-5_000), null, 2)}\n`);
}

async function notify(offers: Offer[]): Promise<void> {
  if (offers.length === 0) {
    console.log('Aucune nouvelle offre — pas d’envoi.');
    return;
  }
  const { GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !ALERT_TO) {
    console.warn('Secrets Gmail absents — envoi ignoré (exécution locale).');
    return;
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  const lines = offers.map((offer) => `${offer.title}\n${offer.academy} — publié le ${offer.date}\n${offer.url}`);
  await transporter.sendMail({
    from: GMAIL_USER,
    to: ALERT_TO,
    subject: `Nouvelles offres Lilmac (${offers.length})`,
    text: lines.join('\n\n'),
    html: offers
      .map((offer) => `<p><strong>${escapeHtml(offer.title)}</strong><br>${escapeHtml(offer.academy)} — publié le ${escapeHtml(offer.date)}<br><a href="${offer.url}">${offer.url}</a></p>`)
      .join(''),
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

const found = await scrape();
const seen = await loadSeen();
const fresh = found.filter((offer) => !seen.has(offer.key));
for (const offer of found) seen.add(offer.key);
await saveSeen(seen);
console.log(`Offres trouvées: ${found.length}; nouvelles: ${fresh.length}`);
for (const offer of fresh) console.log(`- ${offer.title} (${offer.academy}, publié le ${offer.date})`);
await notify(fresh);
