// Simulation version: stored in every save so a load can say whether the rules changed since.
// Bump it on every change to rules or tuning that changes state hashes (RNG draw order, tick
// order, any number in tuning.ts or nodeDefs.ts that alters a run). Bumps so far: aging
// fertility -> 2 (M16), sexes -> 3 (M17). inbreeding penalty -> 4 (M18), bloodline colour gene -> 5 (M20),
// predator mechanics and the `predator` RNG stream -> 6 (M21a). Pure UI changes never bump it.

export const SIM_VERSION = 6
