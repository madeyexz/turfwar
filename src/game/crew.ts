/**
 * Which soldier models the game draws. The default crew is one realistic infantry soldier (CC0, Grab3D)
 * in a navy uniform for the SWAT side and camouflage for the Militia, whose six looks are tints of it
 * (public/assets/operator.glb, tools/import-operator.ts; it moves on the skeleton of soldiers.glb).
 * The first-person arms are its sleeves and gloves in more detail (public/assets/operator-arms.glb). `?soldiers=classic` brings back the Universal Base Characters soldier
 * painted in team colours with procedural gear (public/assets/soldier.glb).
 */
export const crewRequested = (search: string) => !/(?:^|[?&])soldiers=classic(?:&|$)/i.test(search);

export const CREW = crewRequested(typeof location === 'undefined' ? '' : location.search);
