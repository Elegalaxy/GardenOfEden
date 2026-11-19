// Simulation version: stored in every save so a load can say whether the rules changed since.
// Bump it on every change to rules or tuning that changes state hashes (RNG draw order, tick
// order, any number in tuning.ts or nodeDefs.ts that alters a run). Bumps so far: aging
// fertility -> 2 (M16), sexes -> 3 (M17). inbreeding penalty -> 4 (M18), bloodline colour gene -> 5 (M20),
// predator mechanics and the `predator` RNG stream -> 6 (M21a), predators replace the placeable danger zone and Eden gets three -> 7 (M21b), four more traits (sprint, longevity, hardiness, wariness; 12 more birth draws per sexual child) and
// `predator.homeRange` 11 -> 8 (M22), seasons switched on in Eden (seasonal food regrowth, S2) -> 9, predator ecology switched on in Eden (predators eat, starve, age, breed and are re-colonised, E2) -> 10, vision cone switched on in Eden (directional sensing, V2) -> 11, prey rule switched on in Eden (predator count follows the bot count, killsPerCub 3, P2) -> 12, heritable predator traits switched on in Eden (sense, speed and stamina inherited with mutation, six more `predator` draws per cub, H2) -> 13, mate choice switched on in Eden (kin never pair, G2) -> 14. Pure UI changes never bump it.

export const SIM_VERSION = 14
