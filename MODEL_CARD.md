# Model card: Localio footfall model

## What it does

It estimates how many Google reviews a new cafe or QSR would collect in a given Pune locality. Reviews stand in for footfall, because no visit counts are available. The estimate is the demand part of Localio's opportunity score, and it appears in each locality's detail drawer with its range and what drives it.

## Model

- **Type:** ridge regression (scikit-learn `RidgeCV`, alpha chosen from 30 values between 0.01 and 1000), after median imputation and standardisation.
- **Target:** `log(1 + reviews)` per outlet. Review counts run from single digits to tens of thousands, so the log is what's comparable.
- **Trained on:** all 259 outlets in the seed, collected through the Google Places API on 2026-09-18.
- **Code:** `data/localio/ml/footfall.py` and `features.py`. It is refit on every pipeline run, in about a second.

## Inputs

| Feature | What it describes |
|---|---|
| format, chain, price level, hours open, late-night | the outlet itself |
| distance from the city centre | location |
| residents per km² in the catchment | who lives nearby (Meta HRSL population) |
| cafes and QSRs within 500 m and 1 km | how much food and drink is already there |
| median log reviews of outlets within 1 km | how busy the neighbours are |

The neighbourhood features never count the outlet they describe, and a unit test checks this. Star ratings are left out on purpose: a new outlet has none.

To score a locality, the model is asked about a standard new independent outlet at the centre of the locality's existing outlets. The standard outlet has price level 2, is open 13 hours a day and closes before late night: the median independent.

## Evaluation

5-fold `GroupKFold` holding out whole localities, so every error is measured on places the model never saw in training. A random split would let outlets from the same street leak into the test set and flatter the model.

| Model | Mean absolute error (log reviews) | R² | Spearman ρ |
|---|---|---|---|
| Median baseline | 1.300 | −0.01 | −0.10 |
| **Ridge (used)** | **1.211** | **0.12** | **0.36** |
| Gradient boosting (depth 3, 200 trees) | 1.245 | 0.00 | 0.34 |

- **Gate:** the pipeline uses the model only if it beats the median baseline on this test. If it doesn't, the score falls back to observed reviews, and the pipeline log says so.
- **Result:** it passes, by about 7%.
- **Gradient boosting** was tried as the obvious upgrade and did worse at this sample size.

## How to read its output

- **The signal is real but modest.** R² 0.12 means most of the variation in reviews comes from things the model can't see, such as the menu, the brand's pull, the owner and the outlet's age.
- **So every estimate carries an 80% range,** taken from the cross-validated errors. It runs from about 8 times below the estimate to 6 times above. Deccan Gymkhana's new-cafe estimate is about 1,900 reviews, with a range of 230 to 12,000.
- **Use it to compare localities, not to forecast a business.** A rank correlation of 0.36 on unseen localities says the ordering carries information; the absolute numbers don't.

The biggest effects, in log reviews per standard deviation, are:
- cafes and QSRs within 1 km: +0.25
- being a chain: +0.24
- how reviewed the neighbours are: +0.17
- price level: +0.14
- being a QSR: +0.14
- distance from the centre: −0.11

Because the model is linear, each locality's estimate splits exactly into these parts, and the drawer shows the three biggest place-related ones.

## Limitations

- **Reviews aren't visits.** They grow with an outlet's age, and tourists and students review more than office workers. The model learns "how reviewed", which is related to footfall but isn't the same thing.
- **259 outlets is small.** One odd outlet can move a locality's neighbour features.
- **One snapshot.** The data is from September 2026, and there is no time dimension or seasonality.
- **Residents, not daytime population.** Office districts such as Hinjewadi look emptier than they are at lunchtime.
- **The seed's late-night flag looks synthetic.** It is 36% in both formats. It's kept as a feature but its effect is small (+0.03).

## Not for

Lending or investment decisions, or any single-site forecast. It is a way to shortlist localities worth visiting in person, and the How it works view says as much.
