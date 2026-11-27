import { definePrimitive } from "@ui-sdk/core";
import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, AccordionTrigger } from "@ui-sdk/react/accordion";
import { Button } from "@ui-sdk/react/button";
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import {
  ColorPicker,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerSwatchItem,
  ColorPickerSwatches,
} from "@ui-sdk/react/color-picker";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from "@ui-sdk/react/number-input";
import { createParts } from "@ui-sdk/react/primitive";
import { Progress, ProgressIndicator, ProgressLabel, ProgressTrack, ProgressValue } from "@ui-sdk/react/progress";
import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { Rating, RatingItem } from "@ui-sdk/react/rating";
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@ui-sdk/react/select";
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack, SliderValue } from "@ui-sdk/react/slider";
import { Switch, SwitchThumb } from "@ui-sdk/react/switch";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { Textarea } from "@ui-sdk/react/textarea";
import { Toggle } from "@ui-sdk/react/toggle";
import {
  TokenInput,
  TokenInputEditor,
  TokenInputToken,
  TokenInputTokenRemove,
  type TokenInputValue,
} from "@ui-sdk/react/token-input";
import { CheckIcon, ChevronDownIcon, MinusIcon, PlusIcon, StarIcon, Trash2Icon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

type Member = { id: string; name: string; role: string; enabled: boolean };

// The save receipt is observable by both agents, but only save() can advance it.
const receiptState = ({ revision, savedAt }: { revision: number; savedAt: string }) => ({ revision, savedAt });
const receipt = definePrimitive({
  name: "release-receipt",
  options: { revision: "number", savedAt: "string" },
  state: receiptState,
  sync: receiptState,
  controlled: ["revision", "savedAt"],
  agent: { actions: [] },
  api: () => ({}),
  slots: (slot) => ({ root: slot({}) }),
});
const { Root: ReleaseReceipt } = createParts(receipt, { root: "div" });

const visibilityOptions = [
  { value: "private", label: "仅自己" },
  { value: "team", label: "团队可见" },
  { value: "public", label: "公开" },
];
const roleOptions = [
  { value: "admin", label: "管理员" },
  { value: "editor", label: "编辑者" },
  { value: "viewer", label: "只读" },
];
const initialMembers: Member[] = [
  { id: "alice", name: "Alice", role: "editor", enabled: true },
  { id: "bob", name: "Bob", role: "viewer", enabled: true },
];

const controlClass =
  "h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent";

function SelectField({
  label,
  items,
  value,
  onValueChange,
}: {
  label: string;
  items: Array<{ value: string; label: string }>;
  value: string | null;
  onValueChange: (value: string | null) => void;
}) {
  return (
    <Select items={items} value={value} onValueChange={onValueChange}>
      <SelectLabel className="mb-2 block text-sm font-medium">{label}</SelectLabel>
      <SelectTrigger className={`${controlClass} flex items-center justify-between`}>
        <SelectValue />
        <ChevronDownIcon className="size-4" aria-hidden="true" />
      </SelectTrigger>
      <SelectContent className="z-50 min-w-[var(--anchor-width)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            className="flex cursor-default items-center justify-between rounded px-2 py-1.5 text-sm data-[highlighted]:bg-accent"
          >
            {item.label}
            {value === item.value ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-5 rounded-xl border bg-background p-5 shadow-sm">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export function AgentUICapabilityLab() {
  const [tab, setTab] = useState<string | null>("project");
  const [name, setName] = useState("Agent 原生工作台");
  const [description, setDescription] = useState("让 Agent 直接理解并调整可信页面组件。");
  const [visibility, setVisibility] = useState<string | null>("team");
  const [brandColor, setBrandColor] = useState("#7c3aed");
  const [tags, setTags] = useState<TokenInputValue>([
    { id: "tag-ai", type: "tag", value: "ai", label: "AI" },
    { id: "tag-beta", type: "tag", value: "beta", label: "Beta" },
  ]);
  const [strategy, setStrategy] = useState("progressive");
  const [priority, setPriority] = useState(4);
  const [featured, setFeatured] = useState(true);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [rollout, setRollout] = useState<number | number[]>(20);
  const [retries, setRetries] = useState<number | null>(2);
  const [environment, setEnvironment] = useState("production");
  const [autoRollback, setAutoRollback] = useState(true);
  const [email, setEmail] = useState(false);
  const [lark, setLark] = useState(true);
  const [webhook, setWebhook] = useState(true);
  const [advanced, setAdvanced] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState("尚未保存");
  const [revision, setRevision] = useState(0);

  const readiness = useMemo(() => {
    let value = name.trim() && description.trim() ? 35 : 10;
    value += members.some((member) => member.enabled && member.role === "admin") ? 25 : 10;
    value += Number(rollout) > 0 ? 20 : 0;
    value += lark || email || webhook ? 20 : 0;
    return Math.min(value, 100);
  }, [description, email, lark, members, name, rollout, webhook]);

  const updateMember = (id: string, patch: Partial<Member>) =>
    setMembers((current) => current.map((member) => (member.id === id ? { ...member, ...patch } : member)));
  const removeMember = (id: string) => setMembers((current) => current.filter((member) => member.id !== id));
  const addCarol = () =>
    setMembers((current) =>
      current.some((member) => member.id === "carol")
        ? current
        : [...current, { id: "carol", name: "Carol", role: "editor", enabled: true }],
    );
  const save = () => {
    setRevision((value) => value + 1);
    setSavedAt(new Date().toLocaleTimeString());
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-background p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="mt-1 text-lg font-semibold">项目发布控制台</h3>
          </div>
          <ReleaseReceipt
            revision={revision}
            savedAt={savedAt}
            aria-label="发布配置保存记录"
            className="rounded-md bg-muted px-3 py-2 text-right text-xs"
          >
            <div>Revision {revision}</div>
            <div className="text-muted-foreground">最近保存：{savedAt}</div>
          </ReleaseReceipt>
        </div>
        <Progress value={readiness} className="mt-4" aria-label="发布准备度">
          <div className="mb-1 flex justify-between text-xs">
            <ProgressLabel>发布准备度</ProgressLabel>
            <ProgressValue />
          </div>
          <ProgressTrack className="h-2 overflow-hidden rounded-full bg-muted">
            <ProgressIndicator className="h-full bg-primary transition-[width]" />
          </ProgressTrack>
        </Progress>
      </div>

      <Tabs value={tab} onValueChange={setTab} hiddenUntilFound aria-label="项目配置区域">
        <TabsList className="grid grid-cols-3 rounded-lg border bg-muted/40 p-1">
          <TabsTab
            value="project"
            className="rounded-md px-3 py-2 text-sm data-[selected]:bg-background data-[selected]:shadow-sm"
          >
            项目
          </TabsTab>
          <TabsTab
            value="team"
            className="rounded-md px-3 py-2 text-sm data-[selected]:bg-background data-[selected]:shadow-sm"
          >
            团队
          </TabsTab>
          <TabsTab
            value="release"
            className="rounded-md px-3 py-2 text-sm data-[selected]:bg-background data-[selected]:shadow-sm"
          >
            发布
          </TabsTab>
        </TabsList>

        <TabsPanel value="project" className="mt-4 space-y-4">
          <Section title="项目信息" description="文本、长文本、选择、分段控制、评分和 Toggle。">
            <Field name="project-name">
              <FieldLabel className="mb-2 block text-sm font-medium">项目名称</FieldLabel>
              <Input className={controlClass} value={name} onValueChange={setName} />
              <FieldDescription className="mt-1.5 text-xs text-muted-foreground">
                发布页面和通知中使用的名称。
              </FieldDescription>
            </Field>
            <Field name="private-note" data-agent-secret>
              <FieldLabel className="mb-2 block text-sm font-medium">私密备注</FieldLabel>
              <Input className={controlClass} />
            </Field>
            <Field name="project-description">
              <FieldLabel className="mb-2 block text-sm font-medium">项目描述</FieldLabel>
              <Textarea
                className={`${controlClass} min-h-24 py-2`}
                value={description}
                onValueChange={setDescription}
                autoResize
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="project-tags">
                <FieldLabel className="mb-2 block text-sm font-medium">项目标签</FieldLabel>
                <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1">
                  <TokenInput
                    value={tags}
                    onValueChange={setTags}
                    renderToken={(token) => (
                      <TokenInputToken className="inline-flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                        {token.label}
                        <TokenInputTokenRemove className="rounded p-0.5" aria-label={`移除标签 ${token.label}`}>
                          <XIcon className="size-3" aria-hidden="true" />
                        </TokenInputTokenRemove>
                      </TokenInputToken>
                    )}
                  >
                    <TokenInputEditor
                      placeholder="输入标签"
                      className="min-w-24 flex-1 text-sm outline-none data-[empty]:before:content-[attr(aria-placeholder)] data-[empty]:before:text-muted-foreground"
                    />
                  </TokenInput>
                </div>
              </Field>
              <Field name="brand-color">
                <FieldLabel className="mb-2 block text-sm font-medium">品牌色</FieldLabel>
                <ColorPicker value={brandColor} onValueChange={setBrandColor} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ColorPickerSwatch className="size-10 rounded-md border" />
                    <ColorPickerInput className={controlClass} aria-label="品牌色值" />
                  </div>
                  <ColorPickerSwatches className="flex gap-2" aria-label="品牌色预设">
                    {["#7c3aed", "#2563eb", "#059669", "#dc2626"].map((color) => (
                      <ColorPickerSwatchItem
                        key={color}
                        value={color}
                        aria-label={`选择品牌色 ${color}`}
                        className="size-6 rounded-full border"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </ColorPickerSwatches>
                </ColorPicker>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="可见性" items={visibilityOptions} value={visibility} onValueChange={setVisibility} />
              <div>
                <p className="mb-2 text-sm font-medium">发布策略</p>
                <SegmentedControl
                  value={strategy}
                  onValueChange={(value) => value && setStrategy(value)}
                  aria-label="发布策略"
                  className="grid grid-cols-2 rounded-md border p-1"
                >
                  <SegmentedControlItem
                    value="progressive"
                    className="rounded px-2 py-1.5 text-sm data-[checked]:bg-primary data-[checked]:text-primary-foreground"
                  >
                    渐进式
                  </SegmentedControlItem>
                  <SegmentedControlItem
                    value="instant"
                    className="rounded px-2 py-1.5 text-sm data-[checked]:bg-primary data-[checked]:text-primary-foreground"
                  >
                    全量
                  </SegmentedControlItem>
                </SegmentedControl>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-medium">业务优先级</p>
                <Rating
                  value={priority}
                  onValueChange={(value) => setPriority(value ?? 0)}
                  max={5}
                  aria-label="业务优先级"
                  className="flex gap-1"
                >
                  <RatingItem className="text-amber-500">
                    <StarIcon className="size-5 fill-current" aria-hidden="true" />
                  </RatingItem>
                </Rating>
              </div>
              <Toggle
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm data-[pressed]:border-primary data-[pressed]:bg-primary/5"
                pressed={featured}
                onPressedChange={setFeatured}
              >
                首页重点展示
                <span aria-hidden="true">{featured ? "开启" : "关闭"}</span>
              </Toggle>
            </div>
          </Section>
        </TabsPanel>

        <TabsPanel value="team" className="mt-4 space-y-4">
          <Section title="成员与权限" description="动态集合、重复组件、角色选择和危险动作确认。">
            <div className="space-y-3">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-end"
                >
                  <Field name={`member-${member.id}`}>
                    <FieldLabel className="mb-2 block text-sm font-medium">成员 {member.name}</FieldLabel>
                    <Input
                      className={controlClass}
                      value={member.name}
                      onValueChange={(value) => updateMember(member.id, { name: value })}
                    />
                  </Field>
                  <SelectField
                    label={`${member.name} 的角色`}
                    items={roleOptions}
                    value={member.role}
                    onValueChange={(value) => value && updateMember(member.id, { role: value })}
                  />
                  <label className="flex h-10 items-center gap-2 text-sm">
                    <Switch
                      checked={member.enabled}
                      onCheckedChange={(checked) => updateMember(member.id, { enabled: checked })}
                      aria-label={`${member.name} 访问权限`}
                    >
                      <SwitchThumb className="block size-4 rounded-full bg-current" />
                    </Switch>
                    启用
                  </label>
                  <Button
                    className={`${buttonClass} text-destructive`}
                    aria-label={`移除 ${member.name}`}
                    data-agent-confirm={`从项目中移除 ${member.name}`}
                    onClick={() => removeMember(member.id)}
                  >
                    <Trash2Icon className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
            <Button className={buttonClass} onClick={addCarol}>
              <PlusIcon className="size-4" aria-hidden="true" />
              添加 Carol
            </Button>
          </Section>
        </TabsPanel>

        <TabsPanel value="release" className="mt-4 space-y-4">
          <Section title="发布编排" description="Radio、Slider、NumberInput、Checkbox、Switch 和折叠区域。">
            <RadioGroup
              value={environment}
              onValueChange={(value) => value && setEnvironment(value)}
              aria-label="发布环境"
              className="grid grid-cols-2 gap-2"
            >
              {[
                ["staging", "预发布环境"],
                ["production", "生产环境"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <Radio value={value} className="grid size-5 place-items-center rounded-full border">
                    <RadioIndicator className="size-2.5 rounded-full bg-primary" />
                  </Radio>
                  {label}
                </label>
              ))}
            </RadioGroup>
            <Field name="rollout">
              <FieldLabel className="mb-2 block text-sm font-medium">灰度比例</FieldLabel>
              <Slider value={rollout} onValueChange={setRollout} min={0} max={100} step={5} className="space-y-2">
                <SliderControl className="relative flex h-6 items-center">
                  <SliderTrack className="relative h-2 w-full rounded-full bg-muted">
                    <SliderIndicator className="absolute h-full rounded-full bg-primary" />
                  </SliderTrack>
                  <SliderThumb
                    index={0}
                    aria-label="灰度比例"
                    className="absolute size-5 rounded-full border-2 border-primary bg-background"
                  />
                </SliderControl>
                <SliderValue className="text-xs text-muted-foreground" />
              </Slider>
            </Field>
            <Field name="retry-count">
              <FieldLabel className="mb-2 block text-sm font-medium">失败重试次数</FieldLabel>
              <NumberInput value={retries} onValueChange={setRetries} min={0} max={10}>
                <NumberInputGroup className="flex h-10 overflow-hidden rounded-md border">
                  <NumberInputDecrement className="grid w-10 place-items-center border-r" aria-label="减少重试次数">
                    <MinusIcon className="size-4" />
                  </NumberInputDecrement>
                  <NumberInputControl className="min-w-0 flex-1 bg-background px-3 text-center text-sm outline-none" />
                  <NumberInputIncrement className="grid w-10 place-items-center border-l" aria-label="增加重试次数">
                    <PlusIcon className="size-4" />
                  </NumberInputIncrement>
                </NumberInputGroup>
              </NumberInput>
            </Field>
            <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={autoRollback}
                onCheckedChange={(checked) => setAutoRollback(checked === true)}
                aria-label="失败时自动回滚"
                className="grid size-5 place-items-center rounded border"
              >
                <CheckboxIndicator>
                  <CheckIcon className="size-4" />
                </CheckboxIndicator>
              </Checkbox>
              失败时自动回滚
            </label>
            <Accordion value={advanced} onValueChange={setAdvanced} collapsible multiple>
              <AccordionItem value="notifications" className="rounded-md border">
                <AccordionHeader>
                  <AccordionTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium">
                    高级通知设置
                    <ChevronDownIcon className="size-4" />
                  </AccordionTrigger>
                </AccordionHeader>
                <AccordionPanel className="space-y-3 border-t p-3">
                  {[
                    ["邮件通知", email, setEmail],
                    ["飞书通知", lark, setLark],
                    ["Webhook 通知", webhook, setWebhook],
                  ].map(([label, checked, setter]) => (
                    <label key={String(label)} className="flex items-center justify-between text-sm">
                      {String(label)}
                      <Switch
                        checked={Boolean(checked)}
                        onCheckedChange={setter as (value: boolean) => void}
                        aria-label={String(label)}
                      >
                        <SwitchThumb className="block size-4 rounded-full bg-current" />
                      </Switch>
                    </label>
                  ))}
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          </Section>
        </TabsPanel>
      </Tabs>

      <section className="rounded-xl border bg-background p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">提交与结果</h3>
            <p className="mt-1 text-sm text-muted-foreground">展示弹层、确认动作和状态回读。</p>
          </div>
          <Dialog>
            <DialogTrigger className={buttonClass}>检查发布摘要</DialogTrigger>
            <DialogContent inline className="mt-4 rounded-lg border bg-muted/30 p-4">
              <DialogTitle className="font-semibold">发布摘要</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">
                {name} · {visibilityOptions.find((item) => item.value === visibility)?.label} · 灰度 {Number(rollout)}%
              </DialogDescription>
              <ul className="mt-3 space-y-1 text-sm">
                <li>环境：{environment === "production" ? "生产" : "预发布"}</li>
                <li>成员：{members.filter((member) => member.enabled).length} 人</li>
                <li>失败重试：{retries ?? 0} 次</li>
                <li>自动回滚：{autoRollback ? "开启" : "关闭"}</li>
              </ul>
              <DialogClose className={`${buttonClass} mt-4`}>关闭摘要</DialogClose>
            </DialogContent>
          </Dialog>
        </div>
        <Button
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          data-agent-confirm="保存当前项目、团队与发布配置"
          onClick={save}
        >
          保存全部配置
        </Button>
      </section>
    </div>
  );
}
