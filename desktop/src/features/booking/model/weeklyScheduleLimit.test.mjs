import assert from "node:assert/strict";
import test from "node:test";
import { tariffSchema } from "./bookingCore.ts";
import { airhopActionCommandSchema } from "../actions/airhopActionSchemas.ts";

test("tariff storage and agent commands accept 21 weekly classes, reject invalid limits", () => {
  for (const weeklyScheduleLimit of [1, 7, 8, 14, 21, 0, 22, 1.5]) {
    const fields = {
      name: "Три занятия в день",
      priceMinor: 320000,
      currency: "RUB",
      weeklyScheduleLimit,
    };
    const valid =
      Number.isInteger(weeklyScheduleLimit) &&
      weeklyScheduleLimit >= 1 &&
      weeklyScheduleLimit <= 21;
    assert.equal(
      tariffSchema.safeParse({
        ...fields,
        id: "tariff-test",
        organizationId: "airhop",
        status: "active",
        createdAt: "2026-09-09T00:00:00Z",
        updatedAt: "2026-09-09T00:00:00Z",
      }).success,
      valid,
    );
    for (const type of ["CreateTariff", "UpdateTariff"]) {
      assert.equal(
        airhopActionCommandSchema.safeParse({
          ...fields,
          type,
          tariffId: "tariff-test",
        }).success,
        valid,
      );
    }
  }
});
