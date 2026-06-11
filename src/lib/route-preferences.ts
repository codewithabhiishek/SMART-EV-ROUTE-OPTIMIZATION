// Auto-ranking weights — no user preference toggle
export interface ScoreWeights {
  distance: number;
  wait: number;
  traffic: number;
  price: number;
  power: number;
  rating: number;
}

// Single automatic ranking: optimizes for total trip time (drive + charge + wait + detour).
// Price is a secondary tiebreaker only.
const AUTO_WEIGHTS: ScoreWeights = {
  wait:     0.30,
  traffic:  0.20,
  distance: 0.20,
  power:    0.18,
  price:    0.07,
  rating:   0.05,
};

export function getScoreWeights(): ScoreWeights {
  return AUTO_WEIGHTS;
}
