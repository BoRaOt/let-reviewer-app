---
id: ml-GE-08-counting
tos_line: GE-08
subtopic: Permutations and combinations
source_ids: [SRC-0090]
---
Counting problems ask "how many ways?" First decide whether **order matters**.

**Permutations** count arrangements where order matters, such as choosing a president, vice president and secretary from 10 officers. The formula is nPr = n! ÷ (n − r)!. Here 10P3 = 10 × 9 × 8 = 720.

**Combinations** count selections where order does not matter, such as choosing a 3-member committee from 10 people. The formula is nCr = n! ÷ [r!(n − r)!]. Here 10C3 = 720 ÷ 6 = 120, because each group of three can be ordered 3! = 6 ways.

The symbol n! (n factorial) means n × (n − 1) × … × 1, and **0! = 1** by definition.

A quick check: the permutation count is always at least as large as the combination count for the same n and r.
Memory aid: "Position matters → Permutation; Committee → Combination."
Sources: SRC-0090 7.2, 7.3
