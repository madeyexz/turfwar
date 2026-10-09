/** Each public/ file's content hash, by its path there (vite.config.ts fills it in; absent in tests). */
declare const __ASSET_VERSIONS__: Record<string, string>;

/**
 * The URL of a file in public/ ("assets/props.glb") with its content hash as `?v=`: the URL changes
 * exactly when the file does, so browsers (`immutable`, vercel.json) and the service worker keep it
 * until then without asking again, and a changed file is the only one fetched anew.
 */
export function assetUrl(path: string) {
  const v = typeof __ASSET_VERSIONS__ === 'undefined' ? undefined : __ASSET_VERSIONS__[path];
  return import.meta.env.BASE_URL + path + (v ? `?v=${v}` : '');
}
