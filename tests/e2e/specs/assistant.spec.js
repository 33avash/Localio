// The chat's assistant, with its model (Gemini) mocked: what it's sent
// (the ward data, never less), what's shown, that the page never names the
// model, and what happens when it fails.
import { expect, test } from "@playwright/test";

import { open } from "./helpers.js";

async function ask(page, question) {
  await page.getByRole("tab", { name: "Ask" }).click();
  await page.locator("#ask-input").fill(question);
  await page.keyboard.press("Enter");
  return page.locator(".msg-answer").last();
}

test("the assistant's answer is shown with the wards it names, and invented wards are dropped", async ({ page }) => {
  await open(page, "", {
    gemini: () => ({ answer: "Koregaon Park is crowded with cafes; Atlantis is not in Pune.", wards: ["Koregaon Park", "Atlantis"] }),
  });
  const answer = await ask(page, "Is Koregaon Park good for a cafe?");
  await expect(answer).toContainText("Koregaon Park is crowded with cafes");
  await expect(answer.locator(".chip")).toHaveText(["Koregaon Park"]);
});

test("the page never names the model behind the chat", async ({ page }) => {
  await open(page, "", { gemini: () => ({ answer: "Try Baner.", wards: ["Baner Balewadi"] }) });
  await ask(page, "Where should I open a cafe?");
  await expect(page.locator(".msg-answer").last()).toContainText("Try Baner.");
  await page.locator("[data-action=method]").first().click();
  expect(await page.locator("body").innerText()).not.toMatch(/gemini|google/i);
});

test("the assistant is sent the ward's facts from the data, with the rules to stick to them", async ({ page }) => {
  let sent;
  await open(page, "", { gemini: (body) => { sent = body; return { answer: "ok", wards: [] }; } });
  await ask(page, "Tell me about Koregaon Park");
  await expect(page.locator(".msg-answer").last()).toContainText("ok");
  expect(sent.systemInstruction.parts[0].text).toContain("Answer only from the FACTS");
  const facts = sent.contents.at(-1).parts[0].text;
  expect(facts).toContain("Koregaon Park (PMC ward 21)");
  expect(facts).toMatch(/score \d+\/100 for a cafe = residents \d+ \+ eating out \d+ \+ daytime draw \d+ \+ low competition \d+/);
  expect(facts).toContain("32 cafes");
});

test("a follow-up carries the conversation so far", async ({ page }) => {
  const bodies = [];
  await open(page, "", { gemini: (body) => { bodies.push(body); return { answer: `answer ${bodies.length}`, wards: [] }; } });
  await ask(page, "Tell me about Baner");
  await expect(page.locator(".msg-answer").last()).toContainText("answer 1");
  await page.locator("#ask-input").fill("and the rent there?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".msg-answer").last()).toContainText("answer 2");
  const turns = bodies[1].contents.map((c) => c.role);
  expect(turns).toEqual(["user", "model", "user"]);
});

test("when the assistant fails, Localio's own answer is shown instead", async ({ page }) => {
  await open(page, "", { gemini: () => ({ status: 500 }) });
  const answer = await ask(page, "Tell me about Koregaon Park");
  await expect(answer).toContainText("Koregaon Park (PMC ward 21) has");
});
