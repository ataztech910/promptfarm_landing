#!/usr/bin/env node

process.stdin.on("data", async (data) => {
  const input = JSON.parse(data.toString());

  const response = {
    jsonrpc: "2.0",
    id: input.id,
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            source: "mock",
            message: "Mock MCP response",
            input,
          }),
        },
      ],
    },
  };

  process.stdout.write(JSON.stringify(response));
});