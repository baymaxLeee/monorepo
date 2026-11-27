import {z} from "zod";
export const cancelAppCall = z.strictObject({id:z.uuid(),requestId:z.uuid()});
export const appToolCall = cancelAppCall.extend({toolCallId:z.string().min(1),name:z.string().min(1),args:z.record(z.string(),z.unknown())});
