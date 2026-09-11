import assert from "node:assert/strict";
import test from "node:test";
import { majorMoneyInput, parseMajorMoneyInput } from "./bookingMoney.ts";

test("rubles and Brazilian reais retain fractional minor units", () => {
  for (const currency of ["RUB", "BRL"]) {
    assert.equal(parseMajorMoneyInput("3200.50", currency), 320050);
    assert.equal(parseMajorMoneyInput("3200,50", currency), 320050);
    assert.equal(majorMoneyInput(320050, currency), "3200.50");
  }
});
