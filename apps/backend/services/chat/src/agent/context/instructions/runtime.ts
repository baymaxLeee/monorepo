import type { AgentMode } from "../../agents/types.js";
import { xmlSection } from "./xml.js";

const PLAN_CONTRACT = [
  "Analyze and plan only. Do not create or edit the final deliverable or perform side effects.",
  "The <capability_contract> section describes execution-mode abilities and prerequisites. Factor relevant capabilities into the plan, but do not attempt to call them in plan mode.",
  "Only knowledge_search, web_search, list_files, read_file, ask_user, and the planning tools (write_plan/update_plan/update_todos) run in this mode.",
  "Use write_plan to create a Markdown plan or update_plan for the injected active plan.",
  "The plan must contain: # 目标, ## 背景与约束, ## 实施方案, ## 任务, ## 验收标准.",
  "Write ## 任务 as a Markdown checklist (- [ ] one actionable step per line) so it can be turned into a todo list once execution starts.",
  "Encode concurrency in ## 任务 so the execution phase can parallelize: group deliverables that are mutually independent (they do not consume each other's output — e.g. an HTML page, a promo video, and a batch of posters) under a '### 并行产物（可同时生成）' subheading; keep any step that truly depends on another's output on its own line and note the dependency inline (e.g. '(依赖：上面的海报)'). Put all images of one request in a single step (one generate_images call with multiple prompts), never one step per image.",
  "The filename must describe the task and end in -plan.md.",
  "You may call update_todos to track your own research/drafting sub-steps while building the plan; it never replaces the write_plan/update_plan deliverable.",
].join("\n");

const NORMAL_CONTRACT = [
  "Execute directly. Never create or maintain a plan or a *-plan.md file.",
  "Use write_file for new Markdown or HTML deliverables and edit_file for revisions.",
  "For HTML, write_file owns bounded generation, validation, compilation, and persistence.",
  "Use generate_images when the user asks to create, draw, or generate a picture/illustration/poster/icon/logo. Write a rich, concrete visual prompt; the image is persisted and rendered by the application, so never restate file IDs or download steps. When the user wants several images, request them ALL in ONE generate_images call by passing multiple prompts (one per image) — they generate concurrently and render as a single gallery card; never call generate_images more than once for the same request. If it returns an error about a missing image provider, relay that the user must configure an image model in model management.",
  "Use generate_video when the user asks to create or generate a video/animation/short clip. Pass a concrete short-drama PREMISE — protagonist appearance, conflict/stakes, setting, emotional tone, and any pacing or twist ideas — and describe the STORY, not camera angles: the tool's internal storyboard planner turns it into a beat-driven, variable-length shot list. It runs as a background task and can take a few minutes; call it once and wait for that clip — never dispatch a second video for the SAME request while one is running, but you may still fire off other independent deliverables (images, the HTML page) in the same step. The video is persisted and rendered by the application. If it returns an error about a missing video provider, relay that the user must configure a video model in model management.",
  "Batch images into a single call; parallelize deliverables of DIFFERENT types. All images for a request go in ONE generate_images call (multiple prompts → one gallery card), never several image calls. When a task needs several artifacts of different kinds that do not depend on each other (e.g. an HTML page plus a video plus a batch of images), issue their write_file / generate_images / generate_video calls together in the SAME step so they run concurrently — never produce one, wait for it, then start the next. Each call blocks only itself, so dispatching them together runs them in parallel. Serialize only when one artifact genuinely consumes another's output — e.g. an HTML page that must embed an already-generated image, or a video anchored on a generated still; in that case run the dependency first, then the dependents. When executing a plan, its '### 并行产物（可同时生成）' group names exactly this independent set — dispatch the whole group in one step.",
  "Infer reasonable titles, filenames, structure, and visual style unless a missing requirement would make the artifact materially wrong.",
  "For multi-step tasks (3+ distinct steps), drive the todo list in TWO PHASES. PHASE 1 (plan, alone): call update_todos by itself as its own step — do NOT call any generation tool in that same step — and write the COMPLETE list, marking the deliverables you are about to run in parallel as in_progress. Use exactly ONE todo per deliverable and tag it with `deliverable` ('artifact' for write_file/edit_file, 'image' for generate_images, 'video' for generate_video); the entire image batch is ONE 'image' todo (a single generate_images call with multiple prompts), NEVER one todo per image (three posters = one image todo, not three). PHASE 2 (execute): only AFTER that update_todos call returns do you dispatch the tagged deliverables — issue them together in the next step so they run concurrently. Each tagged todo then flips to completed on its own the instant that deliverable finishes, so html / images / video update independently and none waits for the slowest sibling; reconcile any remaining untagged steps after the tool step returns. Skip todos for simple one-step requests.",
  "If the context includes <referenced_plan>, first read_file on that plan, then run PHASE 1 above: seed update_todos alone from its ## 任务 checklist (one todo per deliverable, the whole image batch as a single 'image' todo). Only after it returns, dispatch each independent '### 并行产物（可同时生成）' group together in the next step (each deliverable tagged with its `deliverable` type) and serialize only explicit dependencies.",
].join("\n");

export function renderRuntimeContract(mode: AgentMode): string {
  const body = mode === "plan" ? PLAN_CONTRACT : NORMAL_CONTRACT;
  // Non-null: both contract bodies are always non-empty constants.
  return xmlSection("runtime_contract", body, { mode })!;
}
