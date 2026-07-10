/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion", "date-fns"],
    // Confine standalone-output file tracing to the frontend package.
    // Without this, tracing roots at the repo-level package.json and crawls
    // sibling folders (ml-service/venv is tens of thousands of files),
    // which hangs the "collecting build traces" phase.
    outputFileTracingRoot: import.meta.dirname,
  },
  async redirects() {
    return [
      {
        source: "/result",
        destination: "/predict",
        permanent: true,
      },
      {
        source: "/diagnose",
        destination: "/predict",
        permanent: true,
      },
      {
        source: "/suggest",
        destination: "/predict",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
