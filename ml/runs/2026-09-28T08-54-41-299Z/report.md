# Baseline — current HSN matcher

Run: 2026-09-28T08:54:41.320Z
Model: qwen3:4b (ANN over bge-m3 embeddings of CBIC 4-digit headings)

This is the number a trained classifier has to beat.

## Result

- Items scored: **75** of 76 labelled
- Correct: **39** (accuracy **52.0%**)
- Answered: 61, abstained: 14
- Precision when it answers: **63.9%**
- Excluded: 1 item(s) whose Ollama call failed twice — an outage, not a
  wrong answer, so they are out of the denominator rather than counted as misses.

## By path

| path | n | correct | accuracy |
| --- | --- | --- | --- |
| keyword | 39 | 39 | 100.0% |
| ann+llm | 22 | 0 | 0.0% |
| abstained | 14 | 0 | 0.0% |
| error | 1 | 0 | 0.0% |

The keyword path is the hand-written deterministic rules; ann+llm is embedding retrieval
followed by a closed-vocabulary pick. A high keyword score with a low ann+llm score means the
system works only where somebody already wrote a rule for it.

## Misses

| expected | got | path | description |
| --- | --- | --- | --- |
| 7019 | 8536 | ann+llm | SLEEVE,3MM,FIBER GLASS MATERIAL: FIBER GLASS, COATING: SILICONE, BREAKDOWN VOLTA |
| 7019 | 8536 | ann+llm | SLEEVE,4MM,FIBER GLASS MATERIAL: FIBER GLASS, COATING: SILICONE, BREAKDOWN VOLTA |
| 7019 | 8535 | ann+llm | SILICONE COATED FIBERGLASS SLEEVE, BREAKDOWN VOLTAGE 1.5-4 KV, TEMP. -60 DEGREE  |
| 7019 | 8535 | ann+llm | SLEEVE,10MM MATERIAL: FIBERGLASS, COATING: SILICONE, SIZE: 10 MM, BREAK DOWN VOL |
| 7019 | 8536 | ann+llm | SLEEVE,1MM,FIBER GLASS MATERIAL: FIBER GLASS, COATING: SILICONE, BREAKDOWN VOLTA |
| 7019 | 8536 | ann+llm | SLEEVE,2MM,FIBER GLASS MATERIAL: FIBER GLASS, COATING: SILICONE, BREAKDOWN VOLTA |
| 7019 | 8536 | ann+llm | SILICONE COATED FIBERGLASS SLEEVE, BREAKDOWN VOLTAGE 1.5-4 KV, TEMP. -60 DEGREE  |
| 7019 | 8536 | ann+llm | SLEEVE,8MM,FIBER GLASS MATERIAL: FIBER GLASS, COATING: SILICONE, BREAKDOWN VOLTA |
| 3926 | 3917 | ann+llm | CABLE TIE,250MM MATERIAL: PLASTIC / NYLON, LENGTH: 250 MM, FORM : OF SUPPLY: 100 |
| 3926 | 5607 | ann+llm | SELF LOCKING CABLE TIE,2.5X75MM MATERIAL: NYLON 6/6, COLOR: : ANY, LENGTH: 75 MM |
| 3926 | 8536 | ann+llm | CABLE TIE,150MM MATERIAL: PLASTIC / NYLON, LENGTH: 150 MM, FORM : OF SUPPLY: 100 |
| 3919 | 7410 | ann+llm | SELF ADHESSIVE PVC INSULATING TAPE,GREEN SELF ADHESSIVE PVC : INSULATING TAPE, 1 |
| 3926 | (abstained) | abstained | CABLE TIE,300MM MATERIAL: PLASTIC / NYLON, LENGTH: 300 MM, FORM : OF SUPPLY: 100 |
| 3926 | 8536 | ann+llm | CABLE TIE,500MM MATERIAL: PLASTIC / NYLON, LENGTH: 500 MM, FORM : OF SUPPLY: 100 |
| 7019 | 8536 | ann+llm | SLEEVE,4MM,FIBER GLASS MATERIAL: FIBER GLASS, COATING: : SILICONE, BREAKDOWN VOL |
| 7019 | 8536 | ann+llm | SLEEVE,8MM,FIBER GLASS MATERIAL: FIBER GLASS, COATING: : SILICONE, BREAKDOWN VOL |
| 7019 | 8535 | ann+llm | SLEEVE,10MM MATERIAL: FIBERGLASS, COATING: SILICONE, SIZE: 10 : MM, BREAK DOWN V |
| 3926 | 8536 | ann+llm | CABLE TIE,200MM MATERIAL: PLASTIC / NYLON, LENGTH: 200 MM, FORM : OF SUPPLY: 100 |
| 3919 | 8547 | ann+llm | SELF ADHESSIVE PVC INSULATING TAPE,BLACK SELF ADHESSIVE PVC : INSULATING TAPE, 1 |
| 3919 | 7410 | ann+llm | SELF ADHESSIVE PVC INSULATING TAPE, BLUE SELF ADHESSIVE PVC : INSULATING TAPE, 1 |
| 3919 | 8544 | ann+llm | SELF ADHESSIVE PVC INSULATING TAPE SELF ADHESSIVE PVC : INSULATING TAPE, 1100V G |
| 3919 | 8544 | ann+llm | SELF ADHESSIVE PVC INSULATING TAPE, RED SELF ADHESSIVE PVC : INSULATING TAPE, 11 |
| 3919 | 7607 | ann+llm | ALUMINIUM FOIL TAPE,2IN,30MICRON, TYPE: ACRYLIC ADHESIVE. OFFERED ITEM : SHALL C |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø278.O MM, O.D.Ø322.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø63.O MM, O.D.Ø91.0 MM & THICKNESS : 3.0 MM. MADE FR |
| 8484 | (abstained) | abstained | RECUT GASKET OF SIZE I.D.:-Ø92.O MM, O.D.Ø126.0 MM & THICKNESS : 3.0 MM. MADE FR |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø118.O MM, O.D.Ø156.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø145.O MM, O.D.Ø184.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø223.O MM, O.D.Ø268.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø329.O MM, O.D.Ø379.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø515.O MM, O.D.Ø582.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø618.O MM, O.D.Ø690.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | FLAT RING GASKET TYPE : NON-METALLIC : PRECUT MATERIAL : GRAPHITE OPERATING PRES |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø172.O MM, O.D.Ø214.0 MM & THICKNESS : 3.0 MM. MADE  |
| 8484 | (abstained) | abstained | PRECUT GASKET OF SIZE I.D.:-Ø412.O MM, O.D.Ø468.0 MM & THICKNESS : 3.0 MM. MADE  |
| 7307 | (abstained) | abstained | NIPPLE BARREL M.S.GALVANISED PLAIN, SIZE:15MM X 51MM LONG MIN. : ,MEDIUM QQUALIT |
