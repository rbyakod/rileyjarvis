/// <reference types="vite/client" />

export type ChatArtifactMessage = {
  id: string;
  role: "user" | "jarvis" | "tool";
  text: string;
};

export type RickyArtifact = {
  title: string;
  kind:
    | "text"
    | "markdown"
    | "code"
    | "table"
    | "notes"
    | "mermaid"
    | "image"
    | "imageLoading"
    | "thumbnailBoard"
    | "progress"
    | "chat";
  content: string;
  language?: string;
  fullscreen?: boolean;
  analysis?: string;
  messages?: ChatArtifactMessage[];
};

export type RickyToolSpec = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RickyToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type RickyToolResult = {
  ok: boolean;
  artifact?: RickyArtifact;
  mode?: "display" | "computer";
  message?: string;
  error?: string;
  [key: string]: unknown;
};

export type RickyToolCallMessage = {
  id: string;
  index?: number;
  type?: "function";
  function: { name: string; arguments: string };
};

export type RickyChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: RickyToolCallMessage[];
  tool_call_id?: string;
};

declare global {
  interface Window {
    ricky: {
      createRealtimeToken: () => Promise<{ value: string; expiresAt: number | null }>;
      llmChat: (payload: { messages: RickyChatMessage[] }) => Promise<{
        role: "assistant";
        content: string;
        tool_calls: RickyToolCallMessage[] | null;
      }>;
      executeTool: (toolCall: RickyToolCall) => Promise<RickyToolResult>;
      getToolSpecs: () => Promise<RickyToolSpec[]>;
      onCursorMove: (cb: (point: { x: number; y: number }) => void) => () => void;
      onShowCameraPicker: (cb: (payload: { analyze?: boolean }) => void) => () => void;
    };
  }
}
