import type {
  BookingApplicantSnapshot,
  BookingChild,
  BookingDuplicateCandidate,
  BookingFamily,
  BookingRepresentative,
  BookingWorkspace,
} from "@/features/booking/model/bookingCore";

export type ClientIdentityResolution = {
  familyId: string;
  representativeId: string;
  childId: string;
  families: BookingFamily[];
  representatives: BookingRepresentative[];
  children: BookingChild[];
  duplicateCandidates: BookingDuplicateCandidate[];
};

type ClientIdentityOptions = {
  now: string;
  idFactory: () => string;
};

export function normalizeClientName(value: string, locale: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(locale);
}

function displayClientName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function resolveBookingApplicantIdentity(
  workspace: BookingWorkspace,
  applicant: BookingApplicantSnapshot,
  options: ClientIdentityOptions,
): ClientIdentityResolution {
  const organizationId = workspace.organization.id;
  const locale = workspace.organization.locale;
  const matchingRepresentatives = workspace.representatives.filter(
    (representative) =>
      representative.organizationId === organizationId &&
      representative.phoneNormalized === applicant.phoneNormalized,
  );
  const activeMatches = matchingRepresentatives.filter(
    (representative) =>
      representative.status === "active" &&
      workspace.families.some(
        (family) =>
          family.id === representative.familyId && family.status === "active",
      ),
  );

  let families = workspace.families;
  let representatives = workspace.representatives;
  let children = workspace.children;
  let duplicateCandidates = workspace.duplicateCandidates;
  let familyId: string;
  let representativeId: string;
  let newRepresentative = false;

  if (activeMatches.length === 1) {
    representativeId = activeMatches[0].id;
    familyId = activeMatches[0].familyId;
  } else {
    familyId = `family-${options.idFactory()}`;
    representativeId = `representative-${options.idFactory()}`;
    const parentName = displayClientName(applicant.parentName);
    const family: BookingFamily = {
      id: familyId,
      organizationId,
      displayName: `Семья ${parentName}`,
      primaryRepresentativeId: representativeId,
      status: "active",
      createdAt: options.now,
      updatedAt: options.now,
    };
    const representative: BookingRepresentative = {
      id: representativeId,
      organizationId,
      familyId,
      displayName: parentName,
      firstName: applicant.parentFirstName,
      lastName: applicant.parentLastName,
      phoneNormalized: applicant.phoneNormalized,
      phoneDisplay: applicant.phoneDisplay,
      preferredContactChannel: applicant.preferredContactChannel,
      messengerAccounts: [],
      consentVersion: applicant.consentVersion,
      consentAcceptedAt: applicant.consentAcceptedAt,
      status: "active",
      createdAt: options.now,
      updatedAt: options.now,
    };
    families = [...families, family];
    representatives = [...representatives, representative];
    newRepresentative = true;
  }

  const normalizedChildName = normalizeClientName(applicant.childName, locale);
  const matchingChildren = workspace.children.filter(
    (child) =>
      child.familyId === familyId &&
      child.birthDate === applicant.childBirthDate &&
      normalizeClientName(child.displayName, locale) === normalizedChildName,
  );
  const activeChildren = matchingChildren.filter(
    (child) => child.status === "active",
  );
  let childId: string;
  let newChild = false;

  if (!newRepresentative && activeChildren.length === 1) {
    childId = activeChildren[0].id;
  } else {
    childId = `child-${options.idFactory()}`;
    const child: BookingChild = {
      id: childId,
      organizationId,
      familyId,
      displayName: displayClientName(applicant.childName),
      firstName: applicant.childFirstName,
      lastName: applicant.childLastName,
      birthDate: applicant.childBirthDate,
      status: "active",
      createdAt: options.now,
      updatedAt: options.now,
    };
    children = [...children, child];
    newChild = true;
  }

  const duplicateCandidatesToAdd: BookingDuplicateCandidate[] = [];
  if (newRepresentative) {
    for (const existing of matchingRepresentatives) {
      duplicateCandidatesToAdd.push({
        id: `duplicate-candidate-${options.idFactory()}`,
        organizationId,
        newEntityType: "representative",
        newEntityId: representativeId,
        existingEntityType: "representative",
        existingEntityId: existing.id,
        signals: ["phone"],
        status: "pending",
        createdAt: options.now,
      });
    }
  } else if (newChild) {
    for (const existing of matchingChildren) {
      duplicateCandidatesToAdd.push({
        id: `duplicate-candidate-${options.idFactory()}`,
        organizationId,
        newEntityType: "child",
        newEntityId: childId,
        existingEntityType: "child",
        existingEntityId: existing.id,
        signals: ["name_and_birth_date"],
        status: "pending",
        createdAt: options.now,
      });
    }
  }
  if (duplicateCandidatesToAdd.length > 0) {
    duplicateCandidates = [...duplicateCandidates, ...duplicateCandidatesToAdd];
  }

  return {
    familyId,
    representativeId,
    childId,
    families,
    representatives,
    children,
    duplicateCandidates,
  };
}
