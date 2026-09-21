// Keep the source's Chinese strings and named interpolation app-local.
const t = (key: string, options?: Record<string, unknown>) =>
  key.replace(/\{\{?(\w+)\}?\}/g, (token, name: string) => (options?.[name] == null ? token : String(options[name])));

export default t;
