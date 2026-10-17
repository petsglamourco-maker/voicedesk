// Implemented for Google Calendar (Phase 3, ADR 0014); Microsoft 365 next.

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface CalendarEventInput {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  timezone: string; // IANA
  attendees?: Array<{ email: string; name?: string }>;
}

export interface CalendarEvent extends CalendarEventInput {
  id: string;
}

export interface CalendarSummary {
  id: string;
  name: string;
  primary: boolean;
}

export interface CalendarProvider {
  readonly name: string;
  /** Calendars the connected account can write to (for the business to choose from). */
  listCalendars?(): Promise<CalendarSummary[]>;
  /** Busy ranges for the given calendars within a window. */
  freeBusy(calendarIds: string[], window: TimeRange): Promise<TimeRange[]>;
  createEvent(calendarId: string, event: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(
    calendarId: string,
    eventId: string,
    event: Partial<CalendarEventInput>,
  ): Promise<CalendarEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}
