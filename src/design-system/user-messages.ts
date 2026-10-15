/**
 * Plain-language messages for everything that can go wrong in the day flow. The UI never renders a
 * server error string directly: it classifies the failure into one of these codes and shows the
 * matching title and body. Unknown failures get the generic message and a "Try again" action.
 */
export type UserMessageCode =
  | 'METER_READINGS_MISSING'
  | 'SHIFT_NOT_CLOSED'
  | 'DIFFERENCE_NOT_EXPLAINED'
  | 'DAY_HAS_OPEN_WORK'
  | 'STALE_STATE'
  | 'NOT_PERMITTED'
  | 'SELF_APPROVAL'
  | 'STATION_NOT_SET_UP'
  | 'NO_ATTENDANTS_SELECTED'
  | 'RETURN_REASON_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'UNKNOWN';

export type UserMessage = Readonly<{
  code: UserMessageCode;
  title: string;
  body: string;
}>;

const MESSAGES: Record<UserMessageCode, Omit<UserMessage, 'code'>> = {
  METER_READINGS_MISSING: {
    title: 'Closing readings needed',
    body: 'Enter a closing reading for every pump on this shift before closing it.',
  },
  SHIFT_NOT_CLOSED: {
    title: 'Close the shift first',
    body: 'Close the shift meters, then submit the figures.',
  },
  DIFFERENCE_NOT_EXPLAINED: {
    title: 'Explain the difference',
    body: 'Add a short reason for every difference before submitting.',
  },
  DAY_HAS_OPEN_WORK: {
    title: 'Day can’t be closed yet',
    body: 'Close every shift and get every reconciliation approved first.',
  },
  STALE_STATE: {
    title: 'This was updated by someone else',
    body: 'We’ve loaded the latest version. Check it, then try again.',
  },
  NOT_PERMITTED: {
    title: 'You don’t have access',
    body: 'Ask your manager or administrator if you need this.',
  },
  SELF_APPROVAL: {
    title: 'Someone else must approve this',
    body: 'You submitted these figures, so another manager needs to approve them.',
  },
  STATION_NOT_SET_UP: {
    title: 'Station isn’t set up yet',
    body: 'Add pumps and attendants for this station in Settings before starting a shift.',
  },
  NO_ATTENDANTS_SELECTED: {
    title: 'Choose who is working',
    body: 'Select at least one attendant for this shift.',
  },
  RETURN_REASON_REQUIRED: {
    title: 'Add a reason',
    body: 'Tell the attendant what to correct (at least 10 characters).',
  },
  SESSION_EXPIRED: {
    title: 'Sign in again',
    body: 'Your session has ended. Sign in to carry on where you left off.',
  },
  UNKNOWN: {
    title: 'Something went wrong',
    body: 'Please try again. If it keeps happening, contact your administrator.',
  },
};

export function userMessage(code: UserMessageCode): UserMessage {
  return { code, ...MESSAGES[code] };
}

/** Whether a "Try again" button helps: never for permission or rule failures the person must fix. */
export function isRetryable(code: UserMessageCode): boolean {
  return code === 'UNKNOWN';
}

/**
 * Works out which message applies from what the server sent (HTTP status, error code, free text).
 * The server's wording is only ever used to pick a code, never shown.
 */
export function classifyFailure(
  status: number | undefined,
  serverCode?: string,
  serverText?: string,
): UserMessageCode {
  const text = (serverText ?? '').toLowerCase();
  if (isUserMessageCode(serverCode)) return serverCode;
  if (status === 401) return 'SESSION_EXPIRED';
  if (/self.?approv|submitter cannot approve|approver cannot be the submitter/.test(text)) {
    return 'SELF_APPROVAL';
  }
  if (status === 403 || /not authori[sz]ed|permission/.test(text)) return 'NOT_PERMITTED';
  if (/sealed meter segment|terminal meter-close|meter.?close boundary/.test(text)) {
    return 'METER_READINGS_MISSING';
  }
  if (/non-zero variance|variance explanation|explain/.test(text)) return 'DIFFERENCE_NOT_EXPLAINED';
  if (/every operated shift must be completed|unresolved .*exception blocks day|open work/.test(text)) {
    return 'DAY_HAS_OPEN_WORK';
  }
  if (/return reason|reason is required/.test(text)) return 'RETURN_REASON_REQUIRED';
  if (/shift.*(not|must be).*(closed|meter)/.test(text)) return 'SHIFT_NOT_CLOSED';
  if (/changed elsewhere|stale|expectedversion/.test(text) || serverCode === 'IDEMPOTENCY_CONFLICT') {
    return 'STALE_STATE';
  }
  return 'UNKNOWN';
}

function isUserMessageCode(value: string | undefined): value is UserMessageCode {
  return value !== undefined && value !== 'UNKNOWN' && value in MESSAGES;
}

export function describeFailure(
  status: number | undefined,
  serverCode?: string,
  serverText?: string,
): UserMessage {
  return userMessage(classifyFailure(status, serverCode, serverText));
}
