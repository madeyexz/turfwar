/** Calendar dates in Taipei (UTC+8, no daylight saving). Day numbers encode the local date. */
export const TAIPEI_OFFSET_MS = 8 * 3_600_000;
export const taipeiDay = (ms: number) => Math.floor((ms + TAIPEI_OFFSET_MS) / 86_400_000);
export const taipeiDayOfHour = (hour: number) => Math.floor((hour + 8) / 24);
export const taipeiDayStart = (day: number) => day * 86_400_000 - TAIPEI_OFFSET_MS;

/** ISO-style wall-clock text, independent of the browser's time zone. */
export const taipeiTimestamp = (ms: number) => new Date(ms + TAIPEI_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');

/** First fully recorded calendar day; a collection started during a day cannot describe that whole day. */
export const firstTaipeiDay = (startedAt: number) => Math.ceil((startedAt + TAIPEI_OFFSET_MS) / 86_400_000);
