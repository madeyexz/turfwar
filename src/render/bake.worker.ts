// Works the baked light out off the main thread (bake.ts), so the game keeps its frame rate meanwhile.
import { bakeLight, type BakeInput } from './bake';

self.onmessage = (e: MessageEvent<BakeInput>) => {
  const result = bakeLight(e.data);
  (self as unknown as Worker).postMessage(result, [result.data.buffer]);
};
