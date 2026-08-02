import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev-tools badge in the corner. Off because it sits on top of the UI we are
  // building. Development only; it never appears in a production build either way.
  devIndicators: false,

  // Standalone: Next traces exactly the files it needs and emits a self-contained server, so
  // the container does not have to carry all of node_modules.
  output: "standalone",
};

export default nextConfig;
