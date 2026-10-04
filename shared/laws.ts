import { z } from 'zod';

// Reject coercion and non-finite values before clamping physics-safe bounds.
const bounded = (min: number, max: number) =>
  z.number().finite().transform(value => Math.max(min, Math.min(max, value)));

export const gravitySchema = z.object({
  mode: z.enum(['uniform', 'central']),
  strength: bounded(-200, 200),
  exponent: bounded(0, 3),
  direction: z.object({ x: bounded(-1, 1), y: bounded(-1, 1), z: bounded(-1, 1) }).strict(),
}).strict();
export const timeSchema = z.object({
  mode: z.enum(['constant', 'playerMotion']),
  scale: bounded(0.05, 3),
}).strict();
export const lightSpeedSchema = z.object({ c: bounded(10, 1000) }).strict();
export const rewindSchema = z.object({ seconds: bounded(0, 10) }).strict();

export const lawCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gravity'), gravity: gravitySchema }).strict(),
  z.object({ kind: z.literal('time'), time: timeSchema }).strict(),
  z.object({ kind: z.literal('lightSpeed'), lightSpeed: lightSpeedSchema }).strict(),
  z.object({ kind: z.literal('rewind'), rewind: rewindSchema }).strict(),
]);
export type LawCommand = z.infer<typeof lawCommandSchema>;
export type Laws = {
  gravity: z.infer<typeof gravitySchema>;
  time: z.infer<typeof timeSchema>;
  lightSpeed: z.infer<typeof lightSpeedSchema>;
  rewind: z.infer<typeof rewindSchema>;
};
export const defaultLaws: Laws = {
  gravity: { mode: 'central', strength: 80, exponent: 2, direction: { x: 0, y: -1, z: 0 } },
  time: { mode: 'constant', scale: 1 },
  lightSpeed: { c: 300 },
  rewind: { seconds: 5 },
};

/** Throws ZodError on invalid data; JSON strings must be decoded by the caller. */
export function parseLawCommand(value: unknown): LawCommand {
  return lawCommandSchema.parse(value);
}
