/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standard MCP discovery path (SEP-1649) served by the existing server card route.
  async rewrites() {
    return [{ source: "/.well-known/mcp/server-card.json", destination: "/.well-known/mcp-server-card" }];
  },
  serverExternalPackages: ["mailauth", "mailparser"],
  // Ship the price library (library/**) with every API function, so history reads are local and free.
  outputFileTracingIncludes: {
    "/api/**/*": ["./library/**/*"],
    // /status is rebuilt in the background (revalidate) and reads library/*/meta.json when it does.
    "/status": ["./library/**/*"],
  },
};
export default nextConfig;
