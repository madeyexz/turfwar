/** Each public/ file's content hash, by its path there (vite.config.ts fills it in; absent in tests). */
declare const __ASSET_VERSIONS__: Record<string, string>;
/** The asset CDN of a website build (src/buildtools/assetcdn.ts) and the files it lacks; null without one. */
declare const __ASSET_CDN__: { origin: string; local: string[] } | null;

/**
 * The URL of a file in public/ ("assets/props.glb") with its content hash: on the asset CDN as
 * `/<hash>/<path>` when the build has one that holds the file, else from the site as `<path>?v=<hash>`.
 * Either way the URL changes exactly when the file does, so browsers (`immutable`) and the service
 * worker keep it until then without asking again, and a changed file is the only one fetched anew.
 */
export function assetUrl(path: string) {
  const v = typeof __ASSET_VERSIONS__ === 'undefined' ? undefined : __ASSET_VERSIONS__[path];
  const cdn = typeof __ASSET_CDN__ === 'undefined' ? null : __ASSET_CDN__;
  if (v && cdn && !cdn.local.includes(path)) return `${cdn.origin}/${v}/${path}`;
  return import.meta.env.BASE_URL + path + (v ? `?v=${v}` : '');
}

/** The asset CDN's origin, '' without one. */
export const assetOrigin = (typeof __ASSET_CDN__ === 'undefined' ? null : __ASSET_CDN__)?.origin ?? '';
