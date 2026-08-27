import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const URL = process.env.SEARCH_URL ?? 'https://recrutement.education.gouv.fr/recrutement/offres?term=lettres&Region__c=11';
const STATE_FILE = 'data/seen.json';
const PAGE_FILE = 'public/index.html';
const keywords = ['lettres', 'français'];
type Offer = { id: string; title: string; url: string; foundAt: string };

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c] ?? c);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(2_000);
const foundAt = new Date().toISOString();
const links = await page.locator('a').evaluateAll(as => as.map(a => ({ title: (a.textContent ?? '').replace(/\s+/g, ' ').trim(), url: (a as HTMLAnchorElement).href })));
await browser.close();
const offers: Offer[] = links.filter(x => x.title && keywords.some(k => x.title.toLocaleLowerCase('fr-FR').includes(k))).map(x => ({ ...x, id: x.url, foundAt }));
let seen: string[] = [];
try { seen = JSON.parse(await readFile(STATE_FILE, 'utf8')) as string[]; } catch {}
await writeFile(STATE_FILE, `${JSON.stringify([...new Set([...seen, ...offers.map(o => o.id)])].slice(-2000), null, 2)}\n`);
await mkdir('public', { recursive: true });
const rows = offers.length ? offers.map(o => `<article><time>${new Date(o.foundAt).toLocaleString('fr-FR')}</time><h2>${esc(o.title)}</h2><a href="${esc(o.url)}" target="_blank" rel="noopener">Voir l’offre</a></article>`).join('') : '<p>Aucune offre trouvée lors de la dernière recherche.</p>';
await writeFile(PAGE_FILE, `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Veille emploi professeur de français</title><style>body{font-family:system-ui;max-width:850px;margin:40px auto;padding:0 20px;background:#f6f8fb;color:#172033}main{background:#fff;padding:28px;border-radius:16px}article{border-top:1px solid #ddd;padding:18px 0}time{color:#64748b}a{color:#2563eb}</style><main><h1>Veille emploi — professeur de français</h1><p>Offres en Île-de-France. Mise à jour : ${new Date().toLocaleString('fr-FR')}</p>${rows}</main></html>\n`);
console.log(`Offres trouvées: ${offers.length}; page générée: ${PAGE_FILE}`);
