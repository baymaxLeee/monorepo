import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@packages/components";

type Props = {
  children: ReactNode;
  remoteName: string;
};

type State = {
  error: Error | null;
};

export class RemoteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.remoteName}] remote failed`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="m-6 max-w-lg">
          <CardHeader>
            <CardTitle>微前端加载失败</CardTitle>
            <CardDescription>
              无法加载 <code className="text-xs">{this.props.remoteName}</code>
              。本地开发请确认对应 dev server 已启动（admin 一般为端口 3001）。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {this.state.error.message}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => this.setState({ error: null })}
            >
              重试
            </Button>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}
