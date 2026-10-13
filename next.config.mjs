/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["mailauth", "mailparser"],
  // Ship the price library (library/**) with every API function, so history reads are local and free.
  outputFileTracingIncludes: {
    "/api/**/*": ["./library/**/*"],
  },
};
export default nextConfig;
