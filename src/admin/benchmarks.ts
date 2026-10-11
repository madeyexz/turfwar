import { activeBetween } from './retention';

/**
 * The admin page's reference figures (pure, for tests): BeGone (nplay, 2010–2022), the game Turf War
 * is modelled on, estimated for Taiwan at its peak. Nothing published counts BeGone's players, so the
 * estimate comes from nplay.com in the Wayback Machine (account ids by month, the forums' clans,
 * Alexa's visitors by country) and assumptions marked as such in the funnel. Worked out on 2026-10-11.
 */
export interface Benchmark { metric: string; begone: string; low: number; high: number; how: string }

export const BEGONE_TAIWAN: Benchmark[] = [
  { metric: 'MAU', begone: '≈ 1,500', low: 500, high: 4_000, how: 'players active in the last 30 UTC days' },
  { metric: 'DAU', begone: '≈ 150–250', low: 150, high: 250, how: 'average players a UTC day, the 7 days before today' },
  { metric: 'Peak CCU', begone: '≈ 10–25', low: 10, high: 25, how: 'most players in rooms at once, last 7 days' },
  { metric: 'Lifetime players', begone: '≈ 10,000', low: 5_000, high: 20_000, how: 'players ever seen' },
];

/** The estimate, step by step (monospace). */
export const BEGONE_FUNNEL = `┌──────────────────────────────────────────────────────────────┐
│ nplay accounts created, Jan 2012 – Sep 2014        ≈ 1.0 M   │  measured (archived account IDs)
│   peak ≈ 48k new accounts a month (Oct 2012 – Mar 2013)      │
└───────────────────────────────┬──────────────────────────────┘
                                │  + guests (half of players never signed up)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ New players a month at the peak, worldwide       ≈ 80–100 k  │
└───────────────────────────────┬──────────────────────────────┘
                                │  + returning players (×1.3–2)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ BeGone MAU at the peak, worldwide               ≈ 100–200 k  │
└───────────────────────────────┬──────────────────────────────┘
                                │  × Taiwan share 0.5–2 % (central 1 %)
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ ★ Taiwan MAU at the peak                ≈ 1,500 (500–4,000)  │
└───────────────────────────────┬──────────────────────────────┘
                                │  × DAU/MAU 10–15 %
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Taiwan DAU                                 ≈ 150–250         │
└───────────────────────────────┬──────────────────────────────┘
                                │  × peak-hour share 5–10 %
                                ▼
┌──────────────────────────────────────────────────────────────┐
│ Taiwan peak CCU                            ≈ 10–25           │
│ (about 1–2 full 6v6 rooms on a good evening)                 │
└──────────────────────────────────────────────────────────────┘

Lifetime: about 1.0 M accounts × 1 %  ≈  10,000 Taiwanese accounts (range 5k–20k)`;

/** What the estimate rests on, as list items (HTML allowed). */
export const BEGONE_EVIDENCE = [
  'nplay account ids seen in the Wayback Machine: about 6k (Jan 2012), 119k (Aug 2012), 452k (Mar 2013), 1.0 M (Sep 2014); accounts are for every nplay game, guests are not counted.',
  'Taiwan share: Alexa\'s top 5 visitor countries for nplay.com (2018–19) never include Taiwan (5th place ≈ 5 %); of about 1,300 archived forum topics, the national clans are Turkish, Spanish-speaking, Brazilian and Polish, none from Asia; no BeGone threads on Bahamut or PTT.',
  'Late years: Alexa rank 122k–175k (2018–19), single-digit players online before the 2022 shutdown.',
  'Assumed: half the players were guests, MAU 1.3–2× new players a month, Taiwan 0.5–2 %, DAU/MAU 10–15 %, the busiest hour 5–10 % of the day\'s players. Each figure is good to about 2× either way.',
];

/** Turf War's launch week, before peaks were recorded on the server: the most players in Online rooms at once per Taipei day, rebuilt from PostHog joins and leaves. */
export const LAUNCH_PEAKS: { day: string; peak: number; at: string; partial?: boolean }[] = [
  { day: '10-07', peak: 6, at: '19:55' }, { day: '10-08', peak: 15, at: '15:13' }, { day: '10-09', peak: 20, at: '23:47' },
  { day: '10-10', peak: 16, at: '21:04' }, { day: '10-11', peak: 14, at: '12:59', partial: true },
];

/** Average players active per UTC day from `from` to `to` (inclusive); 0 for an empty span. */
export function averageDaily(players: Iterable<{ days: ReadonlySet<number> }>, from: number, to: number): number {
  if (to < from) return 0;
  const list = [...players];
  let n = 0;
  for (let d = from; d <= to; d++) n += activeBetween(list, d, d);
  return n / (to - from + 1);
}

/** Where a figure sits against a benchmark's range. */
export function versus(value: number, b: Pick<Benchmark, 'low' | 'high'>): 'below' | 'within' | 'above' {
  return value < b.low ? 'below' : value > b.high ? 'above' : 'within';
}
