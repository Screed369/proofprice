/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["mailauth", "mailparser"],
  // Ship the price library (library/**) with every API function, so history reads are local and free.
  outputFileTracingIncludes: {
    "/api/**/*": ["./library/**/*"],
    // /status is rebuilt in the background (revalidate) and reads library/*/meta.json when it does.
    "/status": ["./library/**/*"],
  },
};
export default nextConfig;
