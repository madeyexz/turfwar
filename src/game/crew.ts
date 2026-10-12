/**
 * Which soldier models the game draws. The default crew is Quaternius' "Ultimate Modular Men" (CC0):
 * the SWAT operator for team 0 and street-gang irregulars for the Militia (public/assets/soldiers.glb,
 * tools/import-modular.ts). `?soldiers=classic` brings back the Universal Base Characters soldier
 * painted in team colours with procedural gear (public/assets/soldier.glb).
 */
export const crewRequested = (search: string) => !/(?:^|[?&])soldiers=classic(?:&|$)/i.test(search);

export const CREW = crewRequested(typeof location === 'undefined' ? '' : location.search);
