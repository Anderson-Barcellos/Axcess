import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/stdio.js";

const execFileAsync = promisify(execFile);

const server = new Server({
  name: "axcess-mcp",
  version: "0.1.0",
});

server.tool(
  "delegate.run",
  {
    description: "Executa um comando local via shell sem ambiente interativo.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Binário ou script a ser executado.",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Argumentos repassados para o comando.",
        },
        cwd: {
          type: "string",
          description: "Diretório de trabalho opcional.",
        },
      },
      required: ["command"],
    },
  },
  async ({ input }) => {
    const args = Array.isArray(input.args) ? input.args : [];
    const cwd = typeof input.cwd === "string" ? input.cwd : undefined;

    const { stdout, stderr } = await execFileAsync(input.command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      stdout,
      stderr,
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Erro ao iniciar o servidor MCP:", error);
  process.exit(1);
});
