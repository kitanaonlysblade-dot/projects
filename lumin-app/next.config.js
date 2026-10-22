/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a self-contained .next/standalone build — a minimal
  // server.js plus only the node_modules files actually reached by
  // this app's own import graph, traced automatically — rather than
  // needing the full node_modules directory (dev tooling included)
  // copied into the final Docker image. Dockerfile's runner stage
  // depends on this output existing; without it, that stage would have
  // nothing to copy and the image wouldn't build. Irrelevant to `next
  // dev`/`npm run dev`, so this changes nothing about local development.
  output: 'standalone',
};

module.exports = nextConfig;
