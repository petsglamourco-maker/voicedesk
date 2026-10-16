// v0 interfaces — refined against provider APIs in Phases 3 (SMS) and 4 (WhatsApp).

export interface SmsMessage {
  to: string; // E.164
  /** E.164 number or alphanumeric sender ID where the destination country allows it. */
  from: string;
  body: string;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ id: string }>;
}

export interface WhatsAppTextMessage {
  to: string; // E.164
  /** Free-form text is only allowed inside the 24-hour customer service window. */
  text: string;
}

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  languageCode: string;
  parameters: string[];
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(senderId: string, message: WhatsAppTextMessage): Promise<{ id: string }>;
  sendTemplate(senderId: string, message: WhatsAppTemplateMessage): Promise<{ id: string }>;
}
