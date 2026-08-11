import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev-tools badge in the corner. Off because it sits on top of the UI we are
  // building. Development only; it never appears in a production build either way.
  devIndicators: false,

  // Standalone: Next traces exactly the files it needs and emits a self-contained server, so
  // the container does not have to carry all of node_modules.
  output: "standalone",

  experimental: {
    serverActions: {
      // Room for a 10 MB avatar upload plus headroom for the other fields and React's own
      // multipart encoding overhead. The default is 1 MB, which is exactly what an
      // ordinary form action wants — a stray large upload should NOT sail through — but
      // /setup and the settings avatar field both pass files, and we cap those at 10 MB
      // ourselves in lib/avatar.ts. Keep this in step with MAX_AVATAR_BYTES there.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
