// The chat's labelled questions, run against the real data in the browser:
// named wards must be found, rankings must match the map's own ranking,
// and off-topic questions must be refused. Every case carries the plan it
// assumes (the site's default: cafe, Balanced, all of Pune, 300 sq ft).
import { expect, test } from "@playwright/test";

import { open } from "./helpers.js";

const NAMED = [
  ["Tell me about Koregaon Park", ["Koregaon Park"]],
  ["Is Baner a good place for a QSR?", ["Baner Balewadi"]],
  ["How crowded is Wakad with cafes?", ["Bhujbal Chowk (PCMC 53)"]],
  ["Compare Aundh and Kharadi for a cafe", ["Aundh ITI", "Kharadi Infotech Park"]],
  ["How many people live in Viman Nagar?", ["Vimannagar Sanjay Park"]],
  ["What's the cafe scene like in Magarpatta", ["Magarpatta City"]],
  ["Should I open a burger joint in Kharadi?", ["Kharadi Infotech Park"]],
  ["Is Deccan Gymkhana too crowded for another coffee shop?", ["Kamla Nehru Park"]],
  ["Late-night food options in Katraj", ["Katraj Dairy", "Katraj Maulinagar"]],
  ["Tell me about Nigdi", ["Nigdi (PCMC 13)"]],
  ["What do people eat in Shivajinagar?", ["Model Colony"]],
  ["Is Pimpri under-served for QSRs?", ["Pimpri (PCMC 44)"]],
  ["How many cafes are in Aundh?", ["Aundh ITI"]],
  ["Balewadi or Aundh for a cafe?", ["Baner Balewadi", "Aundh ITI"]],
  ["Tell me about Near Kasarwadi (PCMC 56)", ["Near Kasarwadi (PCMC 56)"]],
  ["Rent in Koregaon Park for 500 sq ft", ["Koregaon Park"]],
];

// question -> the plan the ranking should use
const RANKINGS = [
  ["Where should I open a cafe?", {}],
  ["Where should I open a QSR?", { category: "fast_food" }],
  ["Best area for a QSR with low competition", { category: "fast_food", lens: "quiet" }],
  ["Where is footfall strongest for a new cafe?", { lens: "busy" }],
  ["Recommend a locality for a chai stall", {}],
  ["Top places for a pizza outlet", { category: "fast_food" }],
  ["Best place to open a restaurant", {}],
  ["Which area has the fewest competitors for a QSR?", { category: "fast_food", lens: "quiet" }],
  ["Where would a new fast food outlet do well?", { category: "fast_food" }],
  ["Cafes in PCMC under ₹30k rent", { area: "pcmc", budget: 30000 }],
  ["Best 500 sq ft cafe spot in Pune city", { area: "pmc", sqft: 500 }],
  ["Where should a cafe near offices go?", { emphasis: "daytime" }],
  ["Busy residential areas for a QSR", { category: "fast_food", lens: "busy", emphasis: "residents" }],
];

const OFF_TOPIC = [
  "who won the world cup", "What's the weather in Pune today?", "write me a poem about the sea",
  "best laptop under 50000", "What is the capital of France?", "How do I fix a Python import error?",
  "tell me a joke", "Who is the prime minister of India?", "Translate hello into Hindi",
  "Recommend a good movie for tonight", "How do I open a bank account?",
];

async function ask(page, questions) {
  return page.evaluate(async ({ questions }) => {
    const { reply, wardIndex } = await import("/js/chat.js");
    const { rank } = await import("/js/score.js");
    const [wardsDoc, rent] = await Promise.all(["wards.geojson", "rent.json"].map((f) => fetch(`/data/${f}`).then((r) => r.json())));
    const wards = wardsDoc.features;
    const { presets } = wardsDoc.meta.score;
    const plan = { category: "cafe", weights: { ...presets.balanced }, area: "all", sqft: 300, budget: null, includeLow: false };
    const context = { wards, meta: wardsDoc.meta, rent, plan, ranking: rank(wards, plan, rent), index: wardIndex(wards) };
    // What a question asks for, as a plan: a preset by name, then one part at the top weight.
    const planFor = ({ lens, emphasis, ...rest }) => {
      const weights = { ...(lens ? presets[lens] : plan.weights), ...(emphasis ? { [emphasis]: 5 } : {}) };
      return { ...plan, ...rest, weights };
    };
    return questions.map(([q, asked]) => {
      const answer = reply(q, context);
      const expected = asked ? rank(wards, planFor(asked), rent).slice(0, 5).map((r) => r.feature.properties.name) : null;
      return { q, kind: answer.kind, wards: answer.wards.map((w) => w.properties.name), plan: answer.plan, expected };
    });
  }, { questions });
}

test.beforeEach(async ({ page }) => { await open(page); });

test("named wards are found", async ({ page }) => {
  for (const { q, wards } of await ask(page, NAMED.map(([q]) => [q]))) {
    const expected = NAMED.find(([question]) => question === q)[1];
    expect(wards, q).toEqual(expect.arrayContaining(expected));
  }
});

test("rankings match the map's own ranking for the plan the question asks for", async ({ page }) => {
  for (const { q, kind, wards, expected } of await ask(page, RANKINGS)) {
    expect(kind, q).toBe("ranking");
    expect(wards, q).toEqual(expected);
  }
});

test("off-topic questions are refused and name no ward", async ({ page }) => {
  for (const { q, kind, wards } of await ask(page, OFF_TOPIC.map((q) => [q]))) {
    expect(kind, q).toBe("refuse");
    expect(wards, q).toEqual([]);
  }
});

test("a comparison calls a tie a tie", async ({ page }) => {
  const text = await page.evaluate(async () => {
    const { reply, wardIndex } = await import("/js/chat.js");
    const { rank } = await import("/js/score.js");
    const [wardsDoc, rent] = await Promise.all(["wards.geojson", "rent.json"].map((f) => fetch(`/data/${f}`).then((r) => r.json())));
    // A ward and an identical copy under another name must come out level.
    const baner = wardsDoc.features.find((f) => f.properties.name === "Baner Balewadi");
    const twin = { ...baner, properties: { ...baner.properties, name: "Twin Ward", aliases: [] } };
    const wards = [baner, twin];
    const plan = { category: "fast_food", weights: { ...wardsDoc.meta.score.presets.busy }, area: "all", sqft: 300,
      budget: null, includeLow: false };
    const context = { wards, meta: wardsDoc.meta, rent, plan, ranking: rank(wards, plan, rent), index: wardIndex(wards) };
    return reply("Compare Baner and Twin Ward", context).text;
  });
  expect(text).toContain("they're level");
});

test("gaps, rent, the method and #1 are answered from the data", async ({ page }) => {
  const [gap, rent, method, why, stats] = await ask(page, [
    ["Which areas have no cafes yet?"], ["Cheapest rent for a cafe"], ["How is the score worked out?"],
    ["Why is #1 ranked first?"], ["How many cafes are in Pune?"],
  ]);
  expect(gap.kind).toBe("gap");
  expect(rent.kind).toBe("cheapest");
  expect(method.kind).toBe("method");
  expect(why.kind).toBe("why");
  expect(stats.kind).toBe("stats");
});
