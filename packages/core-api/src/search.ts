import type { MailMessage, MailThread } from "./types.js";

export interface MailSearchQuery {
  text: string[];
  from?: string;
  to?: string;
  subject?: string;
  label?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  after?: Date;
  before?: Date;
}

function tokens(input: string): string[] {
  return input.match(/[^\s:]+:"[^"]*"|"[^"]*"|[^\s]+/g) ?? [];
}

export function parseMailSearch(input: string): MailSearchQuery {
  const query: MailSearchQuery = { text: [] };
  for (const token of tokens(input.trim())) {
    const split = token.indexOf(":");
    const operator = split > 0 ? token.slice(0, split).toLowerCase() : "";
    const value = (split > 0 ? token.slice(split + 1) : token).replace(
      /^"|"$/g,
      "",
    );
    switch (operator) {
      case "from":
        query.from = value.toLowerCase();
        break;
      case "to":
        query.to = value.toLowerCase();
        break;
      case "subject":
        query.subject = value.toLowerCase();
        break;
      case "label":
      case "in":
        query.label = value.toLowerCase();
        break;
      case "has":
        if (value === "attachment") query.hasAttachment = true;
        else query.text.push(token);
        break;
      case "is":
        if (value === "unread") query.isUnread = true;
        else if (value === "read") query.isUnread = false;
        else if (value === "starred") query.isStarred = true;
        else query.text.push(token);
        break;
      case "after":
        query.after = validDate(value);
        break;
      case "before":
        query.before = validDate(value);
        break;
      default:
        query.text.push(token.toLowerCase());
    }
  }
  return query;
}

function validDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function matchesMailSearch(
  message: MailMessage,
  thread: MailThread,
  query: MailSearchQuery,
): boolean {
  const from = `${message.from.name ?? ""} ${message.from.email}`.toLowerCase();
  const recipients = [
    ...message.to,
    ...(message.cc ?? []),
    ...(message.bcc ?? []),
  ]
    .map((address) => `${address.name ?? ""} ${address.email}`)
    .join(" ")
    .toLowerCase();
  const body =
    `${message.subject} ${message.snippet} ${message.bodyText ?? ""}`.toLowerCase();
  if (query.from && !from.includes(query.from)) return false;
  if (query.to && !recipients.includes(query.to)) return false;
  if (query.subject && !message.subject.toLowerCase().includes(query.subject))
    return false;
  if (
    query.label &&
    !thread.labelIds.some((label) => label.toLowerCase() === query.label)
  )
    return false;
  if (
    query.hasAttachment !== undefined &&
    message.hasAttachments !== query.hasAttachment
  )
    return false;
  if (query.isUnread !== undefined && message.unread !== query.isUnread)
    return false;
  if (query.isStarred !== undefined && message.starred !== query.isStarred)
    return false;
  const date = new Date(message.date);
  if (query.after && date < query.after) return false;
  if (query.before && date >= query.before) return false;
  return query.text.every((term) => body.includes(term));
}

export function toFts5Query(query: MailSearchQuery): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    ...query.text.map(escape),
    ...(query.from ? [`sender:${escape(query.from)}`] : []),
    ...(query.subject ? [`subject:${escape(query.subject)}`] : []),
  ].join(" AND ");
}
