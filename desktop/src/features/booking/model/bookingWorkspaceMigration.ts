export function migrateBookingWorkspace(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  let legacy = input as Record<string, unknown>;

  if (legacy.schemaVersion === 1 && Array.isArray(legacy.branches)) {
    legacy = {
      ...legacy,
      schemaVersion: 2,
      branches: legacy.branches.map((branch) =>
        branch && typeof branch === "object" && !Array.isArray(branch)
          ? { status: "active", ...branch }
          : branch,
      ),
    };
  }

  if (
    legacy.schemaVersion === 2 &&
    Array.isArray(legacy.teachers) &&
    Array.isArray(legacy.recurrenceRules)
  ) {
    legacy = {
      ...legacy,
      schemaVersion: 3,
      teachers: legacy.teachers.map((teacher) =>
        teacher && typeof teacher === "object" && !Array.isArray(teacher)
          ? { status: "active", ...teacher }
          : teacher,
      ),
      recurrenceRules: legacy.recurrenceRules.map((rule) =>
        rule && typeof rule === "object" && !Array.isArray(rule)
          ? { status: "active", ...rule }
          : rule,
      ),
    };
  }

  if (
    legacy.schemaVersion === 3 &&
    Array.isArray(legacy.rooms) &&
    Array.isArray(legacy.groups) &&
    Array.isArray(legacy.recurrenceRules) &&
    Array.isArray(legacy.lessonExceptions)
  ) {
    const groups = legacy.groups.filter(
      (group): group is Record<string, unknown> =>
        Boolean(group) && typeof group === "object" && !Array.isArray(group),
    );
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const rules = legacy.recurrenceRules.filter(
      (rule): rule is Record<string, unknown> =>
        Boolean(rule) && typeof rule === "object" && !Array.isArray(rule),
    );
    const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
    legacy = {
      ...legacy,
      schemaVersion: 4,
      rooms: legacy.rooms.map((room) =>
        room && typeof room === "object" && !Array.isArray(room)
          ? { status: "active", ...room }
          : room,
      ),
      lessonExceptions: legacy.lessonExceptions.map((exception) => {
        if (
          !exception ||
          typeof exception !== "object" ||
          Array.isArray(exception) ||
          "original" in exception
        ) {
          return exception;
        }
        const rule = ruleById.get(exception.recurrenceRuleId);
        const group = rule ? groupById.get(rule.groupId) : undefined;
        if (!rule || !group) return exception;
        const branchId = rule.branchIdOverride ?? group.branchId;
        const roomId =
          rule.roomIdOverride !== undefined
            ? rule.roomIdOverride
            : (group.roomId ?? null);
        const teacherIds = rule.teacherIdsOverride ?? group.teacherIds ?? [];
        return {
          ...exception,
          original: {
            startTime: rule.startTime,
            endTime: rule.endTime,
            branchId,
            roomId,
            teacherIds,
          },
        };
      }),
    };
  }

  if (legacy.schemaVersion === 4) {
    legacy = {
      ...legacy,
      schemaVersion: 5,
      bookings: Array.isArray(legacy.bookings) ? legacy.bookings : [],
    };
  }

  if (
    legacy.schemaVersion === 5 &&
    Array.isArray(legacy.bookings) &&
    legacy.organization &&
    typeof legacy.organization === "object" &&
    !Array.isArray(legacy.organization)
  ) {
    const organizationId = (legacy.organization as Record<string, unknown>).id;
    const families: Record<string, unknown>[] = [];
    const representatives: Record<string, unknown>[] = [];
    const children: Record<string, unknown>[] = [];
    const familyByPhone = new Map<
      string,
      {
        familyId: string;
        representativeId: string;
        childByIdentity: Map<string, string>;
        family: Record<string, unknown>;
        representative: Record<string, unknown>;
      }
    >();

    const bookings = legacy.bookings.map((booking) => {
      if (!booking || typeof booking !== "object" || Array.isArray(booking)) {
        return booking;
      }
      const applicant = booking.applicant;
      if (
        !applicant ||
        typeof applicant !== "object" ||
        Array.isArray(applicant)
      ) {
        return booking;
      }
      const applicantRecord = applicant as Record<string, unknown>;
      const phoneNormalized = applicantRecord.phoneNormalized;
      const parentName = applicantRecord.parentName;
      const childName = applicantRecord.childName;
      const childBirthDate = applicantRecord.childBirthDate;
      const createdAt = booking.createdAt;
      const updatedAt = booking.updatedAt;
      if (
        typeof organizationId !== "string" ||
        typeof phoneNormalized !== "string" ||
        typeof parentName !== "string" ||
        typeof childName !== "string" ||
        typeof childBirthDate !== "string" ||
        typeof createdAt !== "string" ||
        typeof updatedAt !== "string"
      ) {
        return booking;
      }

      let identity = familyByPhone.get(phoneNormalized);
      if (!identity) {
        const sequence = families.length + 1;
        const familyId = `legacy-family-${sequence}`;
        const representativeId = `legacy-representative-${sequence}`;
        const family = {
          id: familyId,
          organizationId,
          displayName: `Семья ${parentName}`,
          primaryRepresentativeId: representativeId,
          status: "active",
          createdAt,
          updatedAt,
        };
        const representative = {
          id: representativeId,
          organizationId,
          familyId,
          displayName: parentName,
          phoneNormalized,
          phoneDisplay: applicantRecord.phoneDisplay,
          preferredContactChannel: applicantRecord.preferredContactChannel,
          messengerAccounts: [],
          consentVersion: applicantRecord.consentVersion,
          consentAcceptedAt: applicantRecord.consentAcceptedAt,
          status: "active",
          createdAt,
          updatedAt,
        };
        identity = {
          familyId,
          representativeId,
          childByIdentity: new Map(),
          family,
          representative,
        };
        familyByPhone.set(phoneNormalized, identity);
        families.push(family);
        representatives.push(representative);
      } else if (
        typeof identity.family.updatedAt === "string" &&
        updatedAt > identity.family.updatedAt
      ) {
        identity.family.updatedAt = updatedAt;
        identity.representative.updatedAt = updatedAt;
      }

      const childIdentity = `${childName.trim().toLocaleLowerCase("ru-RU")}:${childBirthDate}`;
      let childId = identity.childByIdentity.get(childIdentity);
      if (!childId) {
        childId = `legacy-child-${children.length + 1}`;
        identity.childByIdentity.set(childIdentity, childId);
        children.push({
          id: childId,
          organizationId,
          familyId: identity.familyId,
          displayName: childName,
          birthDate: childBirthDate,
          status: "active",
          createdAt,
          updatedAt,
        });
      } else {
        const child = children.find((candidate) => candidate.id === childId);
        if (
          child &&
          typeof child.updatedAt === "string" &&
          updatedAt > child.updatedAt
        ) {
          child.updatedAt = updatedAt;
        }
      }

      return {
        ...booking,
        familyId: identity.familyId,
        representativeId: identity.representativeId,
        childId,
      };
    });

    legacy = {
      ...legacy,
      schemaVersion: 6,
      families,
      representatives,
      children,
      duplicateCandidates: [],
      bookings,
    };
  }

  if (
    legacy.schemaVersion === 6 &&
    legacy.organization &&
    typeof legacy.organization === "object" &&
    !Array.isArray(legacy.organization)
  ) {
    legacy = {
      ...legacy,
      schemaVersion: 7,
      organization: {
        ...legacy.organization,
        allowSingleVisitsByDefault: false,
        existingStudentsOnboarding: { status: "not_started" },
      },
      bookings: Array.isArray(legacy.bookings)
        ? legacy.bookings.map((booking) => {
            if (
              !booking ||
              typeof booking !== "object" ||
              Array.isArray(booking)
            ) {
              return booking;
            }
            const source =
              booking.source &&
              typeof booking.source === "object" &&
              !Array.isArray(booking.source)
                ? booking.source
                : {};
            return {
              ...booking,
              visitKind: source.purpose === "lesson" ? "single" : "trial",
              createdBy: "public-booking",
              source: { ...source, channel: "website" },
            };
          })
        : [],
      lessonExceptions: Array.isArray(legacy.lessonExceptions)
        ? legacy.lessonExceptions.map((exception) => {
            if (
              !exception ||
              typeof exception !== "object" ||
              Array.isArray(exception) ||
              exception.kind !== "cancelled" ||
              !exception.effective ||
              typeof exception.effective !== "object" ||
              Array.isArray(exception.effective)
            ) {
              return exception;
            }
            return {
              ...exception,
              effective: {
                ...exception.effective,
                allowSingleVisits: false,
              },
            };
          })
        : [],
      enrollments: [],
      intakeRequests: [],
      pendingActions: [],
      attendanceRecords: [],
    };
  }

  if (
    legacy.schemaVersion === 7 &&
    legacy.organization &&
    typeof legacy.organization === "object" &&
    !Array.isArray(legacy.organization)
  ) {
    legacy = {
      ...legacy,
      schemaVersion: 8,
      organization: {
        ...legacy.organization,
        paymentDayOfMonth: 5,
      },
      tariffs: [],
      paymentExpectations: [],
      enrollments: Array.isArray(legacy.enrollments)
        ? legacy.enrollments.map((enrollment) =>
            enrollment &&
            typeof enrollment === "object" &&
            !Array.isArray(enrollment)
              ? {
                  ...enrollment,
                  assignmentState: "needs_assignment",
                  weeklyScheduleSelections: [],
                }
              : enrollment,
          )
        : [],
    };
  }

  if (legacy.schemaVersion === 8) {
    legacy = {
      ...legacy,
      bookings: Array.isArray(legacy.bookings)
        ? legacy.bookings.map((booking) => {
            if (
              !booking ||
              typeof booking !== "object" ||
              Array.isArray(booking)
            ) {
              return booking;
            }
            const current = booking as Record<string, unknown>;
            const source = current.source;
            return source &&
              typeof source === "object" &&
              !Array.isArray(source)
              ? {
                  ...current,
                  source: {
                    ...source,
                    surface:
                      (source as Record<string, unknown>).surface === "fizz"
                        ? "buzz_agent"
                        : (source as Record<string, unknown>).surface,
                  },
                }
              : booking;
          })
        : legacy.bookings,
      enrollments: Array.isArray(legacy.enrollments)
        ? legacy.enrollments.map((enrollment) =>
            enrollment &&
            typeof enrollment === "object" &&
            !Array.isArray(enrollment) &&
            (enrollment as Record<string, unknown>).source === "fizz"
              ? { ...enrollment, source: "buzz_agent" }
              : enrollment,
          )
        : legacy.enrollments,
      pendingActions: Array.isArray(legacy.pendingActions)
        ? legacy.pendingActions.map((action) => {
            if (
              !action ||
              typeof action !== "object" ||
              Array.isArray(action)
            ) {
              return action;
            }
            const current = action as Record<string, unknown>;
            const { requestedBy, requestedThroughAgentId, ...rest } = current;
            return {
              ...rest,
              initiatedBy: current.initiatedBy ?? requestedBy,
              preparedByAgentId:
                current.preparedByAgentId ?? requestedThroughAgentId,
              specialistRole: current.specialistRole ?? "administrator",
            };
          })
        : legacy.pendingActions,
    };
  }

  return legacy;
}
