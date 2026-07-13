/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: import.meta.dirname,
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion", "date-fns"],
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
        source: "/insights",
        destination: "/results?tab=published",
        permanent: true,
      },
      {
        source: "/history",
        destination: "/results?tab=predictions",
        permanent: true,
      },
      {
        source: "/niches",
        destination: "/brands",
        permanent: true,
      },
      {
        source: "/model-health",
        destination: "/brands",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
