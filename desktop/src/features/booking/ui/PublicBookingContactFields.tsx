import type { Dispatch, SetStateAction } from "react";
import type {
  PublicApplicantDraft,
  PublicApplicantValidationIssue,
} from "@/features/booking/model/publicBooking";
import type { PublicBookingMessages } from "@/features/booking/lib/publicBookingLocale";
import { Input } from "@/shared/ui/input";
import { Checkbox } from "@/shared/ui/checkbox";
import { FieldError } from "./PublicBookingFlowParts";

export function PublicBookingContactFields({
  applicant,
  setApplicant,
  applicantIssues,
  messages,
  maximumBirthDate,
}: {
  applicant: PublicApplicantDraft;
  setApplicant: Dispatch<SetStateAction<PublicApplicantDraft>>;
  applicantIssues: readonly PublicApplicantValidationIssue[];
  messages: PublicBookingMessages;
  maximumBirthDate?: string;
}) {
  return (
    <>
      <label className="block space-y-2" htmlFor="public-parent-name">
        <span className="text-sm font-medium">{messages.parentName}</span>
        <Input
          className="h-11 sm:h-9"
          id="public-parent-name"
          autoComplete="given-name"
          maxLength={80}
          onChange={(event) =>
            setApplicant((current) => ({
              ...current,
              parentName: event.target.value,
            }))
          }
          placeholder={messages.parentNamePlaceholder}
          value={applicant.parentName}
        />
        <FieldError
          issue="parent_name_required"
          issues={applicantIssues}
          messages={messages}
        />
      </label>
      <label className="block space-y-2" htmlFor="public-parent-last-name">
        <span className="text-sm font-medium">{messages.parentLastName}</span>
        <Input
          className="h-11 sm:h-9"
          id="public-parent-last-name"
          autoComplete="family-name"
          maxLength={80}
          onChange={(event) =>
            setApplicant((current) => ({
              ...current,
              parentLastName: event.target.value,
            }))
          }
          placeholder={messages.parentLastNamePlaceholder}
          value={applicant.parentLastName ?? ""}
        />
        <FieldError
          issue="parent_last_name_required"
          issues={applicantIssues}
          messages={messages}
        />
      </label>
      <label className="block space-y-2" htmlFor="public-phone">
        <span className="text-sm font-medium">{messages.phone}</span>
        <Input
          className="h-11 sm:h-9"
          id="public-phone"
          onChange={(event) =>
            setApplicant((current) => ({
              ...current,
              phone: event.target.value,
            }))
          }
          placeholder={messages.phonePlaceholder}
          type="tel"
          value={applicant.phone}
        />
        <FieldError
          issue="phone_invalid"
          issues={applicantIssues}
          messages={messages}
        />
      </label>
      <label className="block space-y-2" htmlFor="public-child-name">
        <span className="text-sm font-medium">{messages.childName}</span>
        <Input
          className="h-11 sm:h-9"
          id="public-child-name"
          onChange={(event) =>
            setApplicant((current) => ({
              ...current,
              childName: event.target.value,
            }))
          }
          placeholder={messages.childNamePlaceholder}
          value={applicant.childName}
        />
        <FieldError
          issue="child_name_required"
          issues={applicantIssues}
          messages={messages}
        />
      </label>
      <label className="block space-y-2" htmlFor="public-child-birth-date">
        <span className="text-sm font-medium">{messages.exactBirthDate}</span>
        <Input
          className="h-11 sm:h-9"
          id="public-child-birth-date"
          data-empty={!applicant.childBirthDate}
          max={maximumBirthDate}
          onChange={(event) =>
            setApplicant((current) => ({
              ...current,
              childBirthDate: event.target.value,
            }))
          }
          type="date"
          value={applicant.childBirthDate}
        />
        <FieldError
          issue="birth_date_invalid"
          issues={applicantIssues}
          messages={messages}
        />
        <FieldError
          issue="birth_date_in_future"
          issues={applicantIssues}
          messages={messages}
        />
      </label>
      <div className="space-y-2">
        <label
          className="flex min-h-11 items-start gap-3 py-1 text-sm leading-5"
          htmlFor="public-consent"
        >
          <Checkbox
            checked={applicant.consentAccepted}
            id="public-consent"
            onCheckedChange={(checked) =>
              setApplicant((current) => ({
                ...current,
                consentAccepted: checked === true,
              }))
            }
          />
          <span>{messages.consent}</span>
        </label>
        <FieldError
          issue="consent_required"
          issues={applicantIssues}
          messages={messages}
        />
      </div>
    </>
  );
}
