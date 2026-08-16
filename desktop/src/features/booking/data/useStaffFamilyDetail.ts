import * as React from "react";

import {
  createHttpStaffFamilyDetailService,
  type StaffFamilyDetail,
  StaffFamilyDetailApiError,
  type StaffFamilyDetailService,
} from "@/features/booking/data/staffFamilyDetailService";

export type StaffFamilyDetailController = {
  status: "loading" | "ready" | "not_found" | "error";
  detail: StaffFamilyDetail | null;
  error: Error | null;
  reload(): Promise<void>;
};

type UseStaffFamilyDetailOptions = {
  service?: StaffFamilyDetailService;
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Owns one server family-card request without consulting demo storage. */
export function useStaffFamilyDetail(
  familyId: string,
  options: UseStaffFamilyDetailOptions = {},
): StaffFamilyDetailController {
  const service = React.useMemo(
    () => options.service ?? createHttpStaffFamilyDetailService(),
    [options.service],
  );
  const [status, setStatus] =
    React.useState<StaffFamilyDetailController["status"]>("loading");
  const [detail, setDetail] = React.useState<StaffFamilyDetail | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const mountedRef = React.useRef(false);
  const requestEpochRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestEpochRef.current += 1;
    };
  }, []);

  const reload = React.useCallback(async (): Promise<void> => {
    const epoch = ++requestEpochRef.current;
    setStatus("loading");
    setError(null);
    try {
      const nextDetail = await service.getFamilyDetail(familyId);
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setDetail(nextDetail);
      setStatus("ready");
    } catch (cause) {
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setDetail(null);
      setError(asError(cause));
      setStatus(
        cause instanceof StaffFamilyDetailApiError && cause.status === 404
          ? "not_found"
          : "error",
      );
      throw cause;
    }
  }, [familyId, service]);

  React.useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);

  return { status, detail, error, reload };
}
