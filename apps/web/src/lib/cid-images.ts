import type { AttachmentMetadata, MailMessage } from "@galmail/core-api";

const MAX_INLINE_BYTES = 1_500_000;
const MAX_INLINE_IMAGES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function cidKeys(contentId: string): string[] {
  const bare = contentId.replace(/^<|>$/g, "").trim().toLowerCase();
  if (!bare) return [];
  return [bare, `cid:${bare}`, `<${bare}>`];
}

/**
 * Fetch inline attachments that have a Content-ID and return a map suitable
 * for rewriting `cid:` image sources inside the sandboxed mail document.
 */
export async function resolveCidImageMap(
  message: MailMessage,
  fetchAttachment: (
    attachment: AttachmentMetadata,
  ) => AsyncIterable<Uint8Array>,
): Promise<Record<string, string>> {
  const candidates = (message.attachments ?? [])
    .filter((item) => item.contentId && !item.quarantined)
    .filter((item) => item.size <= MAX_INLINE_BYTES)
    .slice(0, MAX_INLINE_IMAGES);
  if (!candidates.length) return {};

  const map: Record<string, string> = {};
  await Promise.all(
    candidates.map(async (attachment) => {
      try {
        const chunks: Uint8Array[] = [];
        for await (const chunk of fetchAttachment(attachment)) {
          chunks.push(chunk);
        }
        const bytes = concatChunks(chunks);
        if (!bytes.byteLength) return;
        const mime = attachment.mimeType || "application/octet-stream";
        if (!mime.startsWith("image/")) return;
        const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
        for (const key of cidKeys(attachment.contentId!)) {
          map[key] = dataUrl;
        }
      } catch {
        // Leave cid: unresolved; remote/data images still work.
      }
    }),
  );
  return map;
}
