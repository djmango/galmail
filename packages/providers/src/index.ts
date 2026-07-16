export { createGmailFixtureProvider } from "./gmail/fixture.js";
export {
  createGmailLiveProvider,
  GmailReauthenticationRequired,
  type GmailHttpClient,
  type GmailHttpResponse,
  type GmailLiveOptions,
  type GmailTokenSource,
} from "./gmail/live.js";
export { createMicrosoftFixtureProvider } from "./microsoft/fixture.js";
export {
  createMicrosoftLiveProvider,
  MicrosoftAuthorizationRequired,
  microsoftDeltaCursor,
  type GraphHttpClient,
  type GraphHttpResponse,
  type MicrosoftConsentState,
  type MicrosoftLiveOptions,
  type MicrosoftTokenSource,
} from "./microsoft/live.js";
export {
  beginMicrosoftPkce,
  exchangeMicrosoftCode,
  microsoftAdminConsentUrl,
  MICROSOFT_GRAPH_SCOPES,
  type MicrosoftPkceAttempt,
  type MicrosoftTokenResponse,
} from "./microsoft/oauth.js";
export {
  listMicrosoftCalendarEvents,
  createMicrosoftCalendarEvent,
  updateMicrosoftCalendarEvent,
  deleteMicrosoftCalendarEvent,
  type CalendarEvent,
  type CalendarEventWrite,
} from "./microsoft/calendar.js";
export {
  listGoogleCalendarEvents,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
} from "./gmail/calendar.js";
export {
  listUnifiedInbox,
  demoAccounts,
  type UnifiedAccount,
} from "./unified.js";
