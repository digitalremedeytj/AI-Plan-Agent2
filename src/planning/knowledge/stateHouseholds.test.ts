import assert from "node:assert/strict";
import test from "node:test";
import { NATIONAL_TV_HOUSEHOLDS, STATE_HOUSEHOLDS, findStateHouseholds } from "./stateHouseholds";
import { US_STATES } from "./usStates";

test("every state plus DC has a household count, so no state-targeted plan sizes to zero", () => {
  assert.equal(STATE_HOUSEHOLDS.length, 51);
  for (const state of US_STATES) {
    const households = findStateHouseholds(state.code);
    assert.ok(households, `no households for ${state.code}`);
    assert.ok(households.tvHouseholds > 0, `zero households for ${state.code}`);
  }
});

test("the national universe is the sum of the states, matching the source export", () => {
  const summed = STATE_HOUSEHOLDS.reduce((total, state) => total + state.tvHouseholds, 0);
  assert.equal(NATIONAL_TV_HOUSEHOLDS, summed);
  assert.equal(summed, 122_589_000);
});

test("state lookups accept any casing", () => {
  assert.equal(findStateHouseholds("dc")?.tvHouseholds, 2_672_000);
  assert.equal(findStateHouseholds("CA")?.name, "California");
  assert.equal(findStateHouseholds("ZZ"), undefined);
});
