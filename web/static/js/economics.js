// Unit economics in the browser: a line-for-line mirror of
// data/localio/economics.py, so changing an assumption recomputes every
// figure instantly. Every constant comes from economics.json, which the
// pipeline builds from seed_data/unit_economics.csv. A Playwright test
// checks this file and the pipeline agree to the rupee on every ward.

const QUANTILES = ["p10", "p50", "p90"];
export { QUANTILES };

// The Assumptions tab's starting values: midpoints of the cited ranges.
export function defaults(econ, category, size = null) {
  const chosen = size ?? econ.sizes[category][0];
  const fmt = econ.formats[`${econ.prefix[category]}_${chosen}`];
  return {
    size: chosen,
    sqft: mean(fmt.sqft),
    rent_psf: econ.rent.default,
    setup: mean(fmt.setup),
    target_margin: econ.target_margin,
  };
}

// ward: { multiplier: [p10, p50, p90], per_10k, rent_multiplier }
export function project(econ, category, inputs, ward, cityPer10k) {
  const fmt = econ.formats[`${econ.prefix[category]}_${inputs.size}`];
  const { rates } = econ;
  const base = mean(fmt.revenue);
  const fe = econ.footfall.elasticity;
  const [fLo, fHi] = econ.footfall.clip;
  const footfall = ward.multiplier.map((m) => clip(m > 0 ? m ** fe : 0, fLo, fHi));
  const ce = econ.competition.elasticity;
  const [cLo, cHi] = econ.competition.clip;
  const competition = clip(((1 + cityPer10k) / (1 + ward.per_10k)) ** ce, cLo, cHi);
  const revenue = footfall.map((f) => roundHalfUp(base * f * competition));
  const rent = roundHalfUp(inputs.rent_psf * ward.rent_multiplier * inputs.sqft);
  const variable = rates.food_cost + rates.staff + fmt.royalty;
  const costs = revenue.map((r) => roundHalfUp(rent + variable * r + fmt.fixed));
  const profit = revenue.map((r, i) => r - costs[i]);
  const burden = revenue.map((r) => rent / r).sort((a, b) => a - b);
  let payback = null;
  let note = null;
  if (profit[0] <= 0) {
    note = "may not clear breakeven under conservative assumptions";
  } else {
    const months = [...profit].reverse().map((p) => inputs.setup / p);
    if (months[2] > econ.payback_cap) {
      note = `payback runs past ${roundHalfUp(econ.payback_cap / 12)} years under conservative assumptions`;
    } else {
      payback = months.map((m) => roundHalfUp(m, 1));
    }
  }
  return {
    revenue,
    rent,
    costs,
    profit,
    margin: profit.map((p, i) => (revenue[i] ? roundHalfUp(p / revenue[i], 3) : null)),
    rent_burden: burden.map((b) => roundHalfUp(b, 3)),
    rent_flag: burden[1] > econ.rent.flag,
    payback,
    payback_note: note,
    footfall: footfall.map((f) => roundHalfUp(f, 3)),
    competition: roundHalfUp(competition, 3),
  };
}

// The projection for one locality feature under the current assumptions.
export function projectLocality(econ, category, inputs, properties, cityPer10k) {
  return project(econ, category, inputs, {
    multiplier: properties.capacity.multiplier,
    per_10k: properties.categories[category].per_10k,
    rent_multiplier: properties.rent.multiplier,
  }, cityPer10k);
}

const ORDINALS = ["strongest", "second-strongest", "third-strongest", "fourth-strongest", "fifth-strongest"];
const TIERS = ["premium", "high", "mid", "value", "emerging"];

// Footfall rank against payback rank, within the shortlist. entries: name,
// footfall (capacity multiplier p50), payback (p50 months or null), profit
// (p50), rent_burden (p50), rent_tier. Rent is only blamed when the
// footfall leader's rent burden is over the flag, and it is in a dearer
// tier and pays more of its revenue in rent than the ward that pays back
// soonest.
export function insight(entries, flag) {
  if (entries.length < 2) return null;
  if (entries.every((e) => e.payback === null)) {
    const closest = entries.reduce((a, b) => (b.profit > a.profit ? b : a));
    return "None of your shortlist clears breakeven under conservative assumptions. "
      + `${closest.name} comes closest, at ${rupeesText(closest.profit)} a month profit in the middle case.`;
  }
  const byFootfall = [...entries].sort((a, b) => b.footfall - a.footfall);
  const byReturn = [...entries].sort((a, b) =>
    (a.payback === null) - (b.payback === null) || (a.payback ?? 0) - (b.payback ?? 0) || b.profit - a.profit);
  const fRank = new Map(byFootfall.map((e, i) => [e.name, i]));
  const rRank = new Map(byReturn.map((e, i) => [e.name, i]));
  const best = byReturn[0];
  for (const a of byFootfall) {
    if (a === best || rRank.get(a.name) - fRank.get(a.name) < 2) continue;
    const rent = a.rent_burden > flag && a.rent_burden > best.rent_burden
      && TIERS.indexOf(a.rent_tier) < TIERS.indexOf(best.rent_tier);
    let lead = `${a.name} has the ${ORDINALS[fRank.get(a.name)]} footfall in your shortlist, but `;
    if (rent) {
      lead += `${a.rent_tier} rent pushes rent burden to ${roundHalfUp(a.rent_burden * 100)}% of projected revenue.`;
      if (a.payback === null) {
        return `${lead} ${best.name} projects a payback of about ${roundHalfUp(best.payback)} months, `
          + `where ${a.name} may not clear breakeven under conservative assumptions.`;
      }
      return `${lead} ${best.name} projects a shorter payback (${roundHalfUp(best.payback)} vs `
        + `${roundHalfUp(a.payback)} months)${less(best, a)}.`;
    }
    if (a.payback === null) {
      return `${lead}it may not clear breakeven under conservative assumptions, while ${best.name} `
        + `projects a payback of about ${roundHalfUp(best.payback)} months${less(best, a)}.`;
    }
    return `${lead}${best.name} projects a shorter payback (${roundHalfUp(best.payback)} vs `
      + `${roundHalfUp(a.payback)} months)${less(best, a)}.`;
  }
  const leader = byFootfall[0];
  if (leader === best) {
    return `${best.name} leads your shortlist on both footfall and projected payback `
      + `(about ${roundHalfUp(best.payback)} months).`;
  }
  return `Footfall and payback broadly agree here: ${leader.name} leads on footfall, and ${best.name} on `
    + `projected payback (about ${roundHalfUp(best.payback)} months).`;
}

function less(best, other) {
  const value = roundHalfUp((1 - best.footfall / other.footfall) * 100);
  return value > 0 ? ` on about ${value}% less footfall` : "";
}

// Matches format.js rupees() and the pipeline's _rupees(), with the
// pipeline's rounding so both write the same sentence.
function rupeesText(value) {
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1e5) return `${sign}₹${roundHalfUp(abs / 1e5, 1).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${roundHalfUp(abs / 1e3)}k`;
  return `${sign}₹${roundHalfUp(abs)}`;
}

// The entry insight() needs for one shortlisted ward.
export function insightEntry(properties, projection) {
  return {
    name: properties.name,
    footfall: properties.capacity.multiplier[1],
    payback: projection.payback ? projection.payback[1] : null,
    profit: projection.profit[1],
    rent_burden: projection.rent_burden[1],
    rent_tier: properties.rent.tier,
  };
}

// Math.round's rule, which the pipeline copies, so both agree to the rupee.
export function roundHalfUp(value, digits = 0) {
  if (digits <= 0) {
    const step = 10 ** -digits;
    return Math.floor(value / step + 0.5) * step;
  }
  const scale = 10 ** digits;
  return Math.floor(value * scale + 0.5) / scale;
}

function clip(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}
