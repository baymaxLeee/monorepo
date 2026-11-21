import { z } from "zod";

const clientRef = z.string().min(1).max(128);
export const prepareAttachmentSchema = z
  .object({
    client_ref: clientRef,
    filename: z.string().min(1).max(255),
    media_type: z.string().min(1).max(255),
    size_bytes: z.number().int().nonnegative(),
  })
  .strict();
export const completeAttachmentSchema = z.object({ client_ref: clientRef, upload_id: z.uuid() }).strict();
