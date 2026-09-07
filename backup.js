/*
 * SCS legacy compatibility backup — not loaded by index.html.
 * Build 559 moved the removed Unique-mode entry points here.
 * Standard mode now owns the established standard + unique-game algorithm.
 */

function getUniqueGamesMode() {
  return getGameGenerationMode() === "standard";
}

function setUniqueGamesMode(enabled, persist) {
  setGameGenerationMode("standard", persist);
}

function stepSyncUniqueGames() {
  stepSyncGameGeneration("standard");
}
