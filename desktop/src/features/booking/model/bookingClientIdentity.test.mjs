import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_BOOKING_WORKSPACE } from "./demoSchedule.ts";
import { resolveBookingApplicantIdentity } from "./bookingClientIdentity.ts";

const NOW = "2026-08-05T10:00:00.000Z";

function applicant(overrides = {}) {
  return {
    parentName: "  Ирина   Соколова ",
    phoneNormalized: "+79991234567",
    phoneDisplay: "+7 999 123-45-67",
    childName: "  Маша   Соколова ",
    childBirthDate: "2020-06-15",
    consentVersion: "privacy-v1",
    consentAcceptedAt: NOW,
    preferredContactChannel: "telegram",
    ...overrides,
  };
}

function sequence(...values) {
  let index = 0;
  return () => values[index++] ?? `fallback-${index}`;
}

function withResolution(workspace, resolution) {
  return {
    ...workspace,
    families: resolution.families,
    representatives: resolution.representatives,
    children: resolution.children,
    duplicateCandidates: resolution.duplicateCandidates,
  };
}

test("first booking applicant creates a linked family, representative, and child", () => {
  const resolution = resolveBookingApplicantIdentity(
    DEMO_BOOKING_WORKSPACE,
    applicant(),
    { now: NOW, idFactory: sequence("1", "2", "3") },
  );

  assert.equal(resolution.familyId, "family-1");
  assert.equal(resolution.representativeId, "representative-2");
  assert.equal(resolution.childId, "child-3");
  assert.equal(resolution.families.length, 1);
  assert.equal(resolution.representatives.length, 1);
  assert.equal(resolution.children.length, 1);
  assert.deepEqual(resolution.duplicateCandidates, []);
  assert.equal(
    resolution.families[0].primaryRepresentativeId,
    "representative-2",
  );
  assert.equal(resolution.representatives[0].familyId, "family-1");
  assert.equal(resolution.representatives[0].displayName, "Ирина Соколова");
  assert.equal(resolution.children[0].familyId, "family-1");
  assert.equal(resolution.children[0].displayName, "Маша Соколова");
});

test("same phone and normalized child identity reuse all records stably", () => {
  const first = resolveBookingApplicantIdentity(
    DEMO_BOOKING_WORKSPACE,
    applicant(),
    { now: NOW, idFactory: sequence("1", "2", "3") },
  );
  const workspace = withResolution(DEMO_BOOKING_WORKSPACE, first);
  const second = resolveBookingApplicantIdentity(
    workspace,
    applicant({
      parentName: "Ирина Соколова",
      childName: "маша соколова",
    }),
    { now: "2026-08-05T11:00:00.000Z", idFactory: sequence("unused") },
  );

  assert.equal(second.familyId, first.familyId);
  assert.equal(second.representativeId, first.representativeId);
  assert.equal(second.childId, first.childId);
  assert.equal(second.families, workspace.families);
  assert.equal(second.representatives, workspace.representatives);
  assert.equal(second.children, workspace.children);
  assert.equal(second.duplicateCandidates, workspace.duplicateCandidates);
});

test("one representative can add a second child without duplicating the family", () => {
  const first = resolveBookingApplicantIdentity(
    DEMO_BOOKING_WORKSPACE,
    applicant(),
    { now: NOW, idFactory: sequence("1", "2", "3") },
  );
  const workspace = withResolution(DEMO_BOOKING_WORKSPACE, first);
  const second = resolveBookingApplicantIdentity(
    workspace,
    applicant({ childName: "Пётр", childBirthDate: "2022-03-02" }),
    { now: NOW, idFactory: sequence("4") },
  );

  assert.equal(second.familyId, first.familyId);
  assert.equal(second.representativeId, first.representativeId);
  assert.equal(second.childId, "child-4");
  assert.equal(second.families, workspace.families);
  assert.equal(second.representatives, workspace.representatives);
  assert.equal(second.children.length, 2);
});

test("ambiguous active phone matches create isolated records and duplicate candidates", () => {
  const base = resolveBookingApplicantIdentity(
    DEMO_BOOKING_WORKSPACE,
    applicant(),
    { now: NOW, idFactory: sequence("1", "2", "3") },
  );
  const workspace = withResolution(DEMO_BOOKING_WORKSPACE, base);
  workspace.families = [
    ...workspace.families,
    {
      id: "family-existing-2",
      organizationId: workspace.organization.id,
      displayName: "Семья Другая",
      primaryRepresentativeId: "representative-existing-2",
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  workspace.representatives = [
    ...workspace.representatives,
    {
      ...workspace.representatives[0],
      id: "representative-existing-2",
      familyId: "family-existing-2",
      displayName: "Другой представитель",
    },
  ];

  const resolution = resolveBookingApplicantIdentity(
    workspace,
    applicant({ childName: "Новый ребёнок", childBirthDate: "2021-01-01" }),
    {
      now: NOW,
      idFactory: sequence("amb-1", "amb-2", "amb-3", "amb-4", "amb-5"),
    },
  );

  assert.equal(resolution.familyId, "family-amb-1");
  assert.equal(resolution.representativeId, "representative-amb-2");
  assert.equal(resolution.childId, "child-amb-3");
  assert.equal(resolution.duplicateCandidates.length, 2);
  assert.deepEqual(
    resolution.duplicateCandidates.map((candidate) => candidate.signals),
    [["phone"], ["phone"]],
  );
  assert.ok(
    resolution.duplicateCandidates.every(
      (candidate) =>
        candidate.newEntityId === "representative-amb-2" &&
        candidate.status === "pending",
    ),
  );
});

test("archived representatives are not silently reused", () => {
  const base = resolveBookingApplicantIdentity(
    DEMO_BOOKING_WORKSPACE,
    applicant(),
    { now: NOW, idFactory: sequence("1", "2", "3") },
  );
  const workspace = withResolution(DEMO_BOOKING_WORKSPACE, base);
  workspace.representatives = workspace.representatives.map(
    (representative) => ({
      ...representative,
      status: "archived",
    }),
  );

  const resolution = resolveBookingApplicantIdentity(workspace, applicant(), {
    now: NOW,
    idFactory: sequence("4", "5", "6", "7"),
  });

  assert.equal(resolution.familyId, "family-4");
  assert.equal(resolution.representativeId, "representative-5");
  assert.equal(resolution.childId, "child-6");
  assert.equal(resolution.duplicateCandidates.length, 1);
  assert.equal(
    resolution.duplicateCandidates[0].existingEntityId,
    "representative-2",
  );
});
