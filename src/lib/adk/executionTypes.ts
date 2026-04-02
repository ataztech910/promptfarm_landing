export type McpExecutionRecord = {
  id: string;
  serverId: string;
  serverName: string;
  status: "invoked" | "succeeded" | "failed" | "skipped";
  toolName?: string;
  message?: string;
};

export type McpExecutionSummary = {
  available: number;
  invoked: number;
  failed: number;
  skipped: number;
  records: McpExecutionRecord[];
};
