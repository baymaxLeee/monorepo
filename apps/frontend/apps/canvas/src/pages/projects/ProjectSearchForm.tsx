import { SearchInput } from "../../components/SearchInput";

const webTool = {
  toolname: "search_canvas_projects",
  tooldescription: "按关键词搜索当前用户可访问的画布项目，返回匹配总数与第一页的项目名称和 ID。",
  toolautosubmit: "",
};

export function ProjectSearchForm({
  value,
  onChange,
  search,
}: {
  value: string;
  onChange(value: string): void;
  search(query: string): Promise<{ total: number; projects: { id: string; name: string }[] }>;
}) {
  return (
    <form
      className="w-[240px] max-w-full"
      role="search"
      {...webTool}
      onSubmit={(event) => {
        event.preventDefault();
        const submission = event.nativeEvent as Event & {
          agentInvoked?: boolean;
          respondWith?(result: Promise<unknown>): void;
        };
        if (submission.agentInvoked && submission.respondWith) {
          const query = String(new FormData(event.currentTarget).get("query") ?? "");
          onChange(query);
          submission.respondWith(search(query));
        }
      }}
    >
      <SearchInput
        className="w-full"
        aria-label="搜索画布项目"
        name="query"
        onChange={onChange}
        placeholder="输入关键词搜索"
        value={value}
      />
    </form>
  );
}
