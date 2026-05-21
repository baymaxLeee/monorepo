import { useEffect, useState } from "react";
import { Route, Routes, Link } from "react-router-dom";
import { Button } from "@app/ui-kit";
import { fetchBots, type Bot } from "@app/api-client/admin";

function BotListPage() {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchBots()
      .then((data) => alive && setBots(data))
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>智能体列表 (Bots)</h1>
      <p style={{ color: "#64748b", marginBottom: 16 }}>
        来自后端 <code>admin</code> 服务 <code>GET /v1/bots</code>
      </p>

      <Button onClick={() => window.location.reload()}>刷新</Button>

      <div style={{ marginTop: 24 }}>
        {loading && <p>加载中…</p>}
        {error && (
          <p style={{ color: "#dc2626" }}>
            请求失败:{error}
            <br />
            <small>
              请确认后端 admin 服务已启动: <code>cd apps/backend && just dev admin</code>
            </small>
          </p>
        )}
        {bots && (
          <ul style={{ lineHeight: 1.8 }}>
            {bots.map((b) => (
              <li key={b.id}>
                <strong>{b.name}</strong> — {b.status}{" "}
                <Link to={`/bots/${b.id}`}>详情</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BotDetailPage() {
  return (
    <div style={{ padding: 24 }}>
      <h2>Bot Detail</h2>
      <Link to="/bots">← 返回</Link>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route index element={<BotListPage />} />
      <Route path=":id" element={<BotDetailPage />} />
    </Routes>
  );
}
