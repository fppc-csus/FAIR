export function resolveAgendaScope(item, jurisdictions = []) {
  const meeting = item.meeting;
  const meetingId = meeting?.jurisdictionId ?? meeting?.jurisdiction?.id;
  const known = [item.cityName, item.cityId].filter(Boolean).map((name) => jurisdictions.filter((city) =>
    city.id === name || city.name.toLowerCase() === String(name).trim().toLowerCase(),
  ));
  if (known.some((matches) => matches.length > 1)) {
    return { jurisdictionId: null, meetingDate: null, reason: "AMBIGUOUS_JURISDICTION" };
  }
  const matches = known.flat();
  const ids = new Set(matches.map((city) => city.id));
  if (meetingId && ids.size && (ids.size !== 1 || !ids.has(meetingId))) {
    return { jurisdictionId: null, meetingDate: null, reason: "AMBIGUOUS_JURISDICTION" };
  }
  // cityId may be an ingestion data-source ID, not a Jurisdiction ID.
  // A resolved cityName is sufficient unless another resolved key contradicts it.
  if (!meetingId && ids.size > 1) {
    return { jurisdictionId: null, meetingDate: null, reason: "AMBIGUOUS_JURISDICTION" };
  }
  if (!meetingId && ids.size === 0 && known.length) {
    return { jurisdictionId: null, meetingDate: null, reason: "UNRESOLVED_JURISDICTION" };
  }
  if (meetingId && item.cityName && known[0]?.length === 0) {
    return { jurisdictionId: null, meetingDate: null, reason: "UNRESOLVED_JURISDICTION" };
  }
  const jurisdictionId = meetingId ?? (ids.size === 1 ? [...ids][0] : null);
  const date = item.meetingDate ?? meeting?.meetingDate;
  const itemDate = item.meetingDate ? new Date(item.meetingDate) : null;
  const linkedDate = meeting?.meetingDate ? new Date(meeting.meetingDate) : null;
  if (itemDate && linkedDate) {
    if (Number.isNaN(itemDate.getTime()) || Number.isNaN(linkedDate.getTime())
      || itemDate.toISOString().slice(0, 10) !== linkedDate.toISOString().slice(0, 10)) {
      return { jurisdictionId, meetingDate: null, reason: "AMBIGUOUS_MEETING_DATE" };
    }
  }
  const meetingDate = date ? new Date(date) : null;
  return {
    jurisdictionId,
    meetingDate: meetingDate && !Number.isNaN(meetingDate.getTime()) ? meetingDate : null,
    reason: jurisdictionId ? null : "UNRESOLVED_JURISDICTION",
  };
}

export function disclosureEligibility(scope, row, policy) {
  if (!scope.jurisdictionId) return { status: "REVIEW_REQUIRED", reason: scope.reason ?? "UNRESOLVED_JURISDICTION" };
  const jurisdictionId = row.filing?.politician?.jurisdictionId ?? row.politicianJurisdictionId;
  if (!jurisdictionId) return { status: "REVIEW_REQUIRED", reason: "UNRESOLVED_POLITICIAN_JURISDICTION" };
  if (jurisdictionId !== scope.jurisdictionId) return { status: "INELIGIBLE", reason: "CROSS_JURISDICTION" };
  if (row.filing?.politician?.needsReview) return { status: "REVIEW_REQUIRED", reason: "POLITICIAN_IDENTITY_REVIEW" };
  if (!scope.meetingDate) return { status: "REVIEW_REQUIRED", reason: "MISSING_MEETING_DATE" };
  const year = row.filing?.filingYear ?? row.filingYear;
  if (row.filing?.politicianId && row.schedulePoliticianId && row.filing.politicianId !== row.schedulePoliticianId) {
    return { status: "REVIEW_REQUIRED", reason: "CONFLICTING_POLITICIAN_ID" };
  }
  if (!row.filing?.id && !row.filingId) return { status: "REVIEW_REQUIRED", reason: "MISSING_FILING_ID" };
  if (!row.disclosureId) return { status: "REVIEW_REQUIRED", reason: "MISSING_DISCLOSURE_ID" };
  if (!Number.isInteger(year) || year < 1900 || year > 9999) return { status: "REVIEW_REQUIRED", reason: "MISSING_FILING_YEAR" };
  if (policy.period === "PENDING") return { status: "POLICY_PENDING", reason: "POLICY_PENDING" };
  if (policy.period !== "YEAR_OFFSETS" || !Array.isArray(policy.offsets) || !policy.offsets.every((offset) => Number.isInteger(offset) && offset >= 0)) {
    throw new Error("Unknown filing-period policy");
  }
  return policy.offsets.includes(scope.meetingDate.getUTCFullYear() - year)
    ? { status: "ELIGIBLE", reason: null }
    : { status: "INELIGIBLE", reason: "OUT_OF_PERIOD" };
}