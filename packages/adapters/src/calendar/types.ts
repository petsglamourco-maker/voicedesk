// v0 interface — implemented for Google Calendar and Microsoft 365 in Phase 3.

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

export interface CalendarProvider {
  readonly name: string;
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
