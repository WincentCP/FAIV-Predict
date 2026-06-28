/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
    ];
  },
};

export default nextConfig;
