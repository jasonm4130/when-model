/**
 * The site's pages: which one a render is, the tab strip, each page's title and description, and
 * where the old single page's hash anchors now live. Pure; the server render, the browser's refresh
 * poll and the redirect script on `/` all read these.
 */
import { LABS, labById, type LabId } from '../domain/lab';

/** The pages that read the dashboard. `lab` is one lab's page, `/labs/<id>`. */
export type PageView =
  | { page: 'home' }
  | { page: 'labs' }
  | { page: 'lab'; lab: LabId }
  | { page: 'markets' }
  | { page: 'radar' }
  | { page: 'about' };

/** A tab in the strip. `/backtest` is a tab too, though it reads no dashboard. */
export type NavKey = 'home' | 'labs' | 'markets' | 'radar' | 'about' | 'backtest';

export const NAV: readonly { key: NavKey; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'Home' },
  { key: 'labs', href: '/labs', label: 'Labs' },
  { key: 'markets', href: '/markets', label: 'Markets' },
  { key: 'radar', href: '/radar', label: 'Radar' },
  { key: 'about', href: '/about', label: 'About' },
  { key: 'backtest', href: '/backtest', label: 'Backtest' },
];

/** Every page with the masthead: the dashboard's pages, /backtest and the 404. */
export type SiteView = PageView | { page: 'backtest' } | { page: 'not-found' };

/** The tab a page sits under: one lab's page is under Labs; the 404 is under none. */
export function navKey(view: SiteView): NavKey | undefined {
  if (view.page === 'not-found') return undefined;
  return view.page === 'lab' ? 'labs' : view.page;
}

/** A lab's page path. */
export const labPath = (id: LabId) => `/labs/${id}`;

export interface PageMeta {
  /** The document title. */
  title: string;
  description: string;
}

/**
 * Titles and descriptions for every page but `/`, whose title is the live level (`dropconTitle`).
 * A lab's page names the lab; nothing here moves with the data, so a shared link previews the same.
 */
export function pageMeta(view: Exclude<PageView, { page: 'home' }>): PageMeta {
  switch (view.page) {
    case 'labs':
      return {
        title: 'Lab Watch: when will each AI lab ship? — whenmodel',
        description:
          'Ten frontier AI labs ranked by heat: Polymarket odds of a release inside 72 hours, 7 days and 30 days, release tempo and the latest listing for each.',
      };
    case 'lab': {
      const name = labById(view.lab)?.name ?? view.lab;
      return {
        title: `When will ${name} ship? — whenmodel`,
        description: `When will ${name} release its next model? Polymarket's 72-hour, 7-day and 30-day odds with how far each can be trusted, ${name}'s release tempo and latest listing, and the early warnings and headlines that name it.`,
      };
    }
    case 'markets':
      return {
        title: 'AI release markets — whenmodel',
        description:
          'Polymarket markets on frontier AI model releases, the best-model race and benchmark bets, priced as the book shows them: odds where it is deep, a bid–ask range where it is thin.',
      };
    case 'radar':
      return {
        title: 'Radar: early warnings and fresh drops — whenmodel',
        description:
          'Early warnings with their track records, launches that already landed, fresh OpenRouter listings, open weights trending on Hugging Face, papers and the lab-blog, SDK and Hacker News feed.',
      };
    case 'about':
      return {
        title: 'How DROPCON works — whenmodel',
        description:
          'How the DROPCON lead score adds up, why it is not a forecast, the questions people ask, a short history of vague-posting and the health of every source.',
      };
  }
}

/**
 * Where each old hash anchor of the single-page site now lives. Hashes never reach the server, so
 * a tiny script on `/` reads this table and moves the reader on. `#lab-<id>` is handled for every
 * lab in the registry by `legacyHashTarget`.
 */
export const LEGACY_HASHES: Readonly<Record<string, string>> = {
  // The level's own arithmetic moved to /about.
  'dc-adds': '/about#score',
  labs: '/labs',
  'labs-title': '/labs',
  'lab-watch': '/labs',
  markets: '/markets',
  odds: '/markets',
  'odds-title': '/markets',
  'release-markets': '/markets',
  tells: '/radar',
  'tells-title': '/radar',
  signals: '/radar',
  'early-warnings': '/radar',
  warnings: '/radar',
  'ew-stealth': '/radar#ew-stealth',
  'ew-leaks': '/radar#ew-leaks',
  'ew-streams': '/radar#ew-streams',
  'ew-arch': '/radar#ew-arch',
  'ew-events': '/radar#ew-events',
  landed: '/radar#landed',
  drops: '/radar#drops',
  'shelf-title': '/radar#drops',
  'fresh-drops': '/radar#drops',
  trending: '/radar#drops',
  papers: '/radar#drops',
  feed: '/radar#feed',
  wire: '/radar#feed',
  'wire-title': '/radar#feed',
  osint: '/radar#feed',
  watchlist: '/radar#feed',
  about: '/about',
  faq: '/about#faq-title',
  'faq-title': '/about#faq-title',
  history: '/about#vague-title',
  'vague-title': '/about#vague-title',
  health: '/about#health',
  'source-health': '/about#health',
  sources: '/about#health',
  disclaimer: '/about#disclaimer',
};

/**
 * The page an old hash anchor now points to, or undefined when the hash still means something on
 * `/` (the level, `#main`) or never did. Accepts the hash with or without its "#".
 */
export function legacyHashTarget(hash: string): string | undefined {
  let id: string;
  try {
    id = decodeURIComponent(hash.replace(/^#/, '')).trim().toLowerCase();
  } catch {
    return undefined; // a malformed escape: not one of ours
  }
  if (!id) return undefined;
  const lab = /^lab-(.+)$/.exec(id)?.[1];
  if (lab !== undefined && LABS.some((l) => l.id === lab)) return labPath(lab as LabId);
  return Object.hasOwn(LEGACY_HASHES, id) ? LEGACY_HASHES[id] : undefined;
}
