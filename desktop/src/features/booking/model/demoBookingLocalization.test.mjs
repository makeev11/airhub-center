import assert from "node:assert/strict";
import { test } from "node:test";

import { createInitialDemoBookingWorkspace } from "../data/demoBookingRepository.ts";
import { localizeDemoBookingWorkspace } from "./demoBookingLocalization.ts";

test("demo workspace localizes stable seed records for English", () => {
  const workspace = createInitialDemoBookingWorkspace("Europe/Moscow", "en-US");

  assert.equal(workspace.organization.name, "AirHop Demo Center");
  assert.equal(workspace.organization.locale, "en-US");
  assert.equal(
    workspace.branches.find((branch) => branch.id === "kurskaya")?.name,
    "Kurskaya",
  );
  assert.equal(
    workspace.groups.find((group) => group.id === "robotics-junior")?.name,
    "Junior Robotics",
  );
  assert.equal(
    workspace.teachers.find((teacher) => teacher.id === "teacher-1")
      ?.displayName,
    "Anna Orlova",
  );
  assert.equal(
    workspace.tariffs.find((tariff) => tariff.id === "tariff-weekly-2")?.name,
    "Twice a week",
  );
  assert.ok(
    workspace.paymentExpectations.every(
      (payment) => !/[А-Яа-яЁё]/.test(payment.tariffNameSnapshot),
    ),
  );
});

test("demo workspace switches known seed records back to Russian", () => {
  const english = createInitialDemoBookingWorkspace("Europe/Moscow", "en-US");
  const russian = localizeDemoBookingWorkspace(english, "ru-RU");

  assert.equal(russian.organization.name, "Каляка Маляка");
  assert.equal(russian.organization.locale, "ru-RU");
  assert.equal(
    russian.groups.find((group) => group.id === "robotics-junior")?.name,
    "Робототехника Junior",
  );
  assert.equal(
    russian.tariffs.find((tariff) => tariff.id === "tariff-weekly-2")?.name,
    "2 раза в неделю",
  );
});

test("demo localization preserves user-created and renamed data", () => {
  const workspace = createInitialDemoBookingWorkspace();
  const renamed = {
    ...workspace,
    groups: workspace.groups.map((group) =>
      group.id === "robotics-junior"
        ? { ...group, name: "My custom robotics group" }
        : group,
    ),
    families: [
      ...workspace.families,
      {
        id: "family-custom",
        organizationId: workspace.organization.id,
        displayName: "Семья Макеевых",
        primaryRepresentativeId: "representative-custom",
        status: "active",
        createdAt: "2026-08-16T08:00:00.000Z",
        updatedAt: "2026-08-16T08:00:00.000Z",
      },
    ],
    representatives: [
      ...workspace.representatives,
      {
        id: "representative-custom",
        organizationId: workspace.organization.id,
        familyId: "family-custom",
        displayName: "Андрей Макеев",
        phoneNormalized: "+79779094565",
        phoneDisplay: "+7 977 909-45-65",
        preferredContactChannel: "phone",
        messengerAccounts: [],
        consentVersion: "demo-v1",
        consentAcceptedAt: "2026-08-16T08:00:00.000Z",
        status: "active",
        createdAt: "2026-08-16T08:00:00.000Z",
        updatedAt: "2026-08-16T08:00:00.000Z",
      },
    ],
  };

  const localized = localizeDemoBookingWorkspace(renamed, "en-US");

  assert.equal(
    localized.groups.find((group) => group.id === "robotics-junior")?.name,
    "My custom robotics group",
  );
  assert.equal(localized.families[0]?.displayName, "Семья Макеевых");
});
