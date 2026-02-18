export async function serve(): Promise<void> {
  const { startMcpServer } = await import("@diffprism/mcp-server");
  await startMcpServer();
}
