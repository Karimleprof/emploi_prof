import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const URL = process.env.SEARCH_URL ?? 'https://recrutement.education.gouv.fr/recrutement/offres?term=lettres&Region__c=11';
const STATE_FILE = process.env.STATE_FILE ?? 'data/seen.json';
const PAGE_FILE = process.env.PAGE_FILE ?? 'public/index.html';
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

const esc = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

async function writePage(found: Offer[]): Promise<void> {
  const checkedAt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Paris' }).format(new Date());
  const rows = found.length
    ? found
        .map((offer) => `<article><h2>${esc(offer.title)}</h2><p class="meta">${esc(offer.academy)} — publié le ${esc(offer.date)}</p><a href="${esc(offer.url)}" target="_blank" rel="noopener">Voir la recherche sur le site</a></article>`)
        .join('')
    : '<p>Aucune offre trouvée lors de la dernière recherche.</p>';
  const html = `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Veille emploi professeur de lettres</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:850px;margin:40px auto;padding:0 20px;background:#f6f8fb;color:#172033}main{background:#fff;padding:28px;border-radius:16px}article{border-top:1px solid #e2e8f0;padding:18px 0}h1{font-size:1.4rem}h2{font-size:1.05rem;margin:0 0 6px}.meta{color:#64748b;margin:0 0 8px}a{color:#2563eb}.check{background:#eefbf3;border-left:4px solid #16a34a;padding:12px 16px;border-radius:6px}.alert{background:#fffbeb;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px}</style><main><h1>Veille emploi — professeur de lettres</h1><p>Offres en Île-de-France, nouvelles offres signalées par Telegram.</p><p class="check"><strong>Dernière vérification :</strong> ${esc(checkedAt)}</p>${rows}</main></html>\n`;
  await mkdir(dirname(PAGE_FILE), { recursive: true });
  await writeFile(PAGE_FILE, html);
}

const found = await scrape();
const seen = await loadSeen();
const fresh = found.filter((offer) => !seen.has(offer.key));
for (const offer of found) seen.add(offer.key);
await saveSeen(seen);
await writePage(found);

console.log(`Offres trouvées: ${found.length}; nouvelles: ${fresh.length}; page: ${PAGE_FILE}`);
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
