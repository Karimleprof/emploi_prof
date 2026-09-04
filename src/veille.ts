import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const URL = process.env.SEARCH_URL ?? 'https://recrutement.education.gouv.fr/recrutement/offres?term=lettres&Region__c=11';
const STATE_FILE = process.env.STATE_FILE ?? 'data/seen.json';
const KEYWORDS = ['lettres', 'français'];

type Offer = { key: string; title: string; academy: string; date: string; url: string };

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
        url: URL,
      });
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

async function notifyTelegram(text: string): Promise<void> {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn('Secrets Telegram absents — envoi ignoré (exécution locale).');
    return;
  }
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
  });
  if (!response.ok) throw new Error(`Échec envoi Telegram: ${response.status} ${await response.text()}`);
}

const found = await scrape();
const seen = await loadSeen();
const fresh = found.filter((offer) => !seen.has(offer.key));
for (const offer of found) seen.add(offer.key);
await saveSeen(seen);

console.log(`Offres trouvées: ${found.length}; nouvelles: ${fresh.length}`);
for (const offer of fresh) console.log(`- ${offer.title} (${offer.academy}, publié le ${offer.date})`);

const isTest = process.env.TEST_NOTIFICATION === 'true';
if (isTest) {
  await notifyTelegram(`✅ Test réussi : la veille peut vous envoyer des notifications Telegram.\n\nDernière vérification : ${found.length} offre(s) trouvée(s), ${fresh.length} nouvelle(s).`);
} else if (fresh.length > 0) {
  const message = `🔔 Nouvelles offres (${fresh.length})\n\n${fresh
    .map((offer) => `💼 ${offer.title}\n🏫 ${offer.academy}\n📅 Publié le ${offer.date}\n🔗 ${offer.url}`)
    .join('\n\n')}`;
  await notifyTelegram(message);
} else {
  console.log('Aucune nouvelle offre — pas d’envoi.');
}
