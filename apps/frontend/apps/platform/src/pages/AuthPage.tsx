import { FormEvent, useState, type CSSProperties } from "react";
import { login, register, type AuthSession } from "@packages/auth-client";

type Mode = "login" | "register";

type AuthPageProps = {
  onAuthenticated: (session: AuthSession) => void;
};

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session =
        mode === "login"
          ? await login({ email, password })
          : await register({ email, password, displayName });
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.panel}>
        <div>
          <p style={styles.eyebrow}>Platform</p>
          <h1 style={styles.title}>{mode === "login" ? "登录" : "注册账号"}</h1>
        </div>
        <div style={styles.switcher} aria-label="auth mode">
          <button
            type="button"
            onClick={() => setMode("login")}
            style={
              mode === "login" ? styles.switcherActive : styles.switcherButton
            }
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            style={
              mode === "register"
                ? styles.switcherActive
                : styles.switcherButton
            }
          >
            注册
          </button>
        </div>
        <form onSubmit={submit} style={styles.form}>
          {mode === "register" ? (
            <label style={styles.field}>
              <span style={styles.label}>显示名称</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                style={styles.input}
                autoComplete="name"
              />
            </label>
          ) : null}
          <label style={styles.field}>
            <span style={styles.label}>邮箱</span>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={styles.input}
              type="email"
              autoComplete="email"
              required
            />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>密码</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              style={styles.input}
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={8}
              required
            />
          </label>
          {error ? <div style={styles.error}>{error}</div> : null}
          <button type="submit" disabled={submitting} style={styles.submit}>
            {submitting ? "处理中..." : mode === "login" ? "登录" : "创建账号"}
          </button>
        </form>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#f8fafc",
    padding: 24,
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  panel: {
    width: "min(420px, 100%)",
    display: "grid",
    gap: 22,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: 28,
    boxShadow: "0 16px 40px rgba(15, 23, 42, 0.08)",
  },
  eyebrow: {
    margin: 0,
    color: "#64748b",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase" as const,
  },
  title: {
    margin: "4px 0 0",
    color: "#111827",
    fontSize: 28,
    lineHeight: 1.2,
  },
  switcher: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    overflow: "hidden",
  },
  switcherButton: {
    border: 0,
    background: "#ffffff",
    color: "#334155",
    padding: "10px 12px",
    cursor: "pointer",
  },
  switcherActive: {
    border: 0,
    background: "#0f172a",
    color: "#ffffff",
    padding: "10px 12px",
    cursor: "pointer",
  },
  form: {
    display: "grid",
    gap: 14,
  },
  field: {
    display: "grid",
    gap: 6,
  },
  label: {
    color: "#334155",
    fontSize: 14,
    fontWeight: 600,
  },
  input: {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: "11px 12px",
    fontSize: 15,
    outlineColor: "#2563eb",
  },
  error: {
    border: "1px solid #fecaca",
    borderRadius: 6,
    background: "#fef2f2",
    color: "#991b1b",
    padding: "10px 12px",
    fontSize: 14,
  },
  submit: {
    border: 0,
    borderRadius: 6,
    background: "#2563eb",
    color: "#ffffff",
    padding: "12px 14px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;
