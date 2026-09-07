# Balanced Mode — Approved Rules

## Hard rules

1. Calculate the round's required seats from its Doubles and Singles courts.
2. Select resting players by persistent FIFO before forming games.
3. If one player rests, use the combined-player FIFO.
4. If multiple players rest, use the eligible Top Men, Bottom Men, Top Women, and Bottom Women FIFOs.
5. Resting players move to the back of the applicable queues; queues are not rebuilt from ratings during a session.
6. Maintain independent participation FIFO/count history for every game type (Free, MD, WD/LD, XD, Free Singles, Men's Singles, Ladies' Singles).
7. Ratings are used only to divide the frozen playing pool into Top (`1`) and Bottom (`0`).
8. Ordinary Doubles teams must have equal binary totals: `0 vs 0`, `1 vs 1`, or `2 vs 2`.
9. Singles opponents must have equal binary values: `0 vs 0` or `1 vs 1`.
10. Gender and court-format requirements are hard constraints.
11. Fixed pairs stay together and may play against either Top or Bottom opponents; they are exempt from binary equality.
12. Repeated pairs, opponents, and complete games are allowed when required to preserve the hard rules.
13. Never silently weaken a hard rule. Return a clear generation error when no valid complete round exists.

## Selection order

1. Court capacity and format.
2. Gender eligibility.
3. Fixed-pair atomicity.
4. Rest FIFO.
5. Per-game-type FIFO/appearance fairness.
6. Binary equality for ordinary teams.
7. Partner/opponent freshness as a tie-breaker only.

## Required validation

- Every active player appears exactly once as playing or resting.
- No player appears on multiple courts.
- Every court has the correct team size and gender composition.
- Every ordinary game passes binary equality.
- Every fixed pair remains together.
- Rest and type-appearance spreads remain as even as the hard constraints permit.
