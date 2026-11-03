import type { ChatMessage } from "./types";

/** Lossless cuts at paragraph/sentence boundaries; never cut a URL, list or code block. */
export function splitPhoneReply(text: string): string[] {
  text = text.trim();
  if (!text || /^(?:null|undefined)+$/i.test(text)) return [];
  if (/```|~~~/.test(text)) return [text];
  const parts: string[] = [];
  let offset = 0;
  for (const block of text.split(/(?<=\n)[ \t]*\n+/)) {
    // Locate the original delimiter rather than synthesizing formatting.
    const start = text.indexOf(block, offset);
    if (start > offset && parts.length) parts[parts.length - 1] += text.slice(offset, start);
    offset = start + block.length;
    if (!block.trim()) continue;
    if (/https?:\/\/|www\.|^[ \t]*(?:[-*+>] |\d+[.)、] )/m.test(block)
      || /[“”「」『』"]/.test(block)) {
      parts.push(block);
      continue;
    }
    let cut = 0;
    // Split at every complete sentence so phone bubbles read like separate messages.
    // URL/list/code blocks are handled above; a decimal point only matches when
    // followed by whitespace or the end of the block.
    for (const match of block.matchAll(/[。！？!?](?:[’）)]*)(?:[ \t]*)|\.(?=\s|$)/gu)) {
      const end = match.index! + match[0].length;
      if (end > cut && end < block.length) {
        parts.push(block.slice(cut, end)); cut = end;
      }
    }
    const tail = block.slice(cut);
    if (tail.trim()) parts.push(tail);
    else if (parts.length) parts[parts.length - 1] += tail;
  }
  if (offset < text.length && parts.length) parts[parts.length - 1] += text.slice(offset);
  // Very long explanations retain all content without flooding the conversation.
  return parts.length > 8 ? [...parts.slice(0, 7), parts.slice(7).join("")] : parts;
}

export function phoneReplyMessages(message: ChatMessage): ChatMessage[] {
  if (message.role !== "assistant" || message.kind !== "text" || message.metadata?.event === "call_reply"
    || message.metadata?.event === "call" || /^(?:life|date)(?::|$)/.test(message.sessionId ?? "")) return [message];
  const parts = splitPhoneReply(message.content);
  if (parts.length < 2) return parts.length ? [{ ...message, content: parts[0] }] : [];
  let joiner = "";
  return parts.map((part, index) => {
    const leading = part.match(/^\s*/u)![0];
    const metadata: Record<string, unknown> = { ...message.metadata, replyBatchId: message.id, replyPart: index, replyPartCount: parts.length, replyJoiner: joiner + leading };
    // Cards and attachments belong to one bubble, not every part of the reply.
    if (index !== parts.length - 1) delete metadata.card;
    joiner = part.match(/\s*$/u)![0];
    return { ...message, id: index ? `${message.id}-part-${index}` : message.id,
      content: part.trim(), mediaId: index === parts.length - 1 ? message.mediaId : undefined,
      metadata, createdAt: message.createdAt + index / 1000 };
  });
}

/** Request-only view: one logical reply uses one history slot and one summary entry. */
export function collapsePhoneMessages(rows: ChatMessage[]): ChatMessage[] {
  rows = rows.filter(row => !row.metadata?.retractedAt && !row.metadata?.hiddenAt);
  const result: ChatMessage[] = [];
  for (let i = 0; i < rows.length; i++) {
    const first = rows[i], batch = first.metadata?.replyBatchId;
    if (typeof batch !== "string" || first.role !== "assistant" || first.kind !== "text") { result.push(first); continue; }
    let content = first.content, previousPart = Number(first.metadata?.replyPart);
    while (i + 1 < rows.length) {
      const next = rows[i + 1], part = Number(next.metadata?.replyPart);
      if (next.metadata?.replyBatchId !== batch || next.sessionId !== first.sessionId || next.speakerId !== first.speakerId
        || next.role !== first.role || next.kind !== first.kind || !Number.isInteger(part) || part <= previousPart) break;
      const joiner = typeof next.metadata?.replyJoiner === "string" && /^\s{0,100}$/u.test(next.metadata.replyJoiner) ? next.metadata.replyJoiner : "\n\n";
      content += (part === previousPart + 1 ? joiner : "\n\n") + next.content;
      previousPart = part; i++;
    }
    const metadata = { ...first.metadata };
    for (const key of ["replyBatchId", "replyPart", "replyPartCount", "replyJoiner"]) delete metadata[key];
    result.push({ ...first, content, metadata });
  }
  return result;
}
