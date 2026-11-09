export function resolveAgendaScope(item, jurisdictions = []) {
  const meeting = item.meeting;
  const observedDate = item.meetingDate ?? meeting?.meetingDate;
  const meetingDate = observedDate && !Number.isNaN(new Date(observedDate).getTime()) ? new Date(observedDate) : null;
  const itemDate = item.meetingDate ? new Date(item.meetingDate) : null;
  const linkedDate = meeting?.meetingDate ? new Date(meeting.meetingDate) : null;
  // Date ambiguity is independent of city resolution; it always blocks detection.
  if (itemDate && linkedDate && (Number.isNaN(itemDate.getTime()) || Number.isNaN(linkedDate.getTime())
    || itemDate.getTime() !== linkedDate.getTime())) {
    return { jurisdictionId: null, meetingDate: null, reason: "AMBIGUOUS_MEETING_DATE" };
  }
  const meetingId = meeting?.jurisdictionId ?? meeting?.jurisdiction?.id;
  const known = [item.cityName, item.cityId].filter(Boolean).map((name) => jurisdictions.filter((city) =>
    city.id === name || city.name.toLowerCase() === String(name).trim().toLowerCase(),
  ));
  if (known.some((matches) => matches.length > 1)) {
    return { jurisdictionId: null, meetingDate, reason: "AMBIGUOUS_JURISDICTION" };
  }
  const matches = known.flat();
  const ids = new Set(matches.map((city) => city.id));
  if (meetingId && ids.size && (ids.size !== 1 || !ids.has(meetingId))) {
    return { jurisdictionId: null, meetingDate, reason: "AMBIGUOUS_JURISDICTION" };
  }
  // cityId may be an ingestion data-source ID, not a Jurisdiction ID.
  // A resolved cityName is sufficient unless another resolved key contradicts it.
  if (!meetingId && ids.size > 1) {
    return { jurisdictionId: null, meetingDate, reason: "AMBIGUOUS_JURISDICTION" };
  }
  if (!meetingId && ids.size === 0 && known.length) {
    return { jurisdictionId: null, meetingDate, reason: "UNRESOLVED_JURISDICTION" };
  }
  if (meetingId && item.cityName && known[0]?.length === 0) {
    return { jurisdictionId: null, meetingDate, reason: "UNRESOLVED_JURISDICTION" };
  }
  const jurisdictionId = meetingId ?? (ids.size === 1 ? [...ids][0] : null);
  return {
    jurisdictionId,
    meetingDate,
    reason: jurisdictionId ? null : "UNRESOLVED_JURISDICTION",
  };
}

export function disclosureEligibility(scope, row, policy) {
  if (scope.reason === "AMBIGUOUS_MEETING_DATE") return { status: "REVIEW_REQUIRED", reason: scope.reason };
  if (!scope.meetingDate) return { status: "REVIEW_REQUIRED", reason: "MISSING_MEETING_DATE" };
  if (!scope.meetingDateVerifiedAt || !scope.meetingDateVerifiedBy || !scope.meetingDateVerifiedValue
    || new Date(scope.meetingDateVerifiedValue).getTime() !== scope.meetingDate.getTime()) {
    return { status: "REVIEW_REQUIRED", reason: "UNVERIFIED_MEETING_DATE" };
  }
  const jurisdictionId = row.filing?.politician?.jurisdictionId ?? row.politicianJurisdictionId;
  if (!jurisdictionId) return { status: "REVIEW_REQUIRED", reason: "UNRESOLVED_POLITICIAN_JURISDICTION" };
  const politician = row.filing?.politician;
  if (!politician?.jurisdictionVerifiedAt || !politician.jurisdictionVerifiedBy || politician.jurisdictionVerifiedId !== jurisdictionId) {
    return { status: "REVIEW_REQUIRED", reason: "UNVERIFIED_POLITICIAN_JURISDICTION" };
  }
  if (row.filing?.politician?.needsReview) return { status: "REVIEW_REQUIRED", reason: "POLITICIAN_IDENTITY_REVIEW" };
  const year = row.filing?.filingYear ?? row.filingYear;
  if (row.filing?.politicianId && row.schedulePoliticianId && row.filing.politicianId !== row.schedulePoliticianId) {
    return { status: "REVIEW_REQUIRED", reason: "CONFLICTING_POLITICIAN_ID" };
  }
  if (!row.filing?.id && !row.filingId) return { status: "REVIEW_REQUIRED", reason: "MISSING_FILING_ID" };
  if (!row.disclosureId) return { status: "REVIEW_REQUIRED", reason: "MISSING_DISCLOSURE_ID" };
  if (!Number.isInteger(year) || year < 1900 || year > 9999) return { status: "REVIEW_REQUIRED", reason: "MISSING_FILING_YEAR" };
  if (!row.filing?.filingYearVerifiedAt || !row.filing.filingYearVerifiedBy || row.filing.filingYearVerifiedValue !== year) {
    return { status: "REVIEW_REQUIRED", reason: "UNVERIFIED_FILING_YEAR" };
  }
  if (policy.jurisdiction !== "ALL_VERIFIED" || policy.period !== "ALL_VERIFIED") throw new Error("Unknown eligibility policy");
  return { status: "ELIGIBLE", reason: null };
}