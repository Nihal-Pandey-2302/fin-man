import { fileURLToPath, URL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// `vite dev` runs the Worker inside workerd (same runtime as production) with the
// local D1 from .wrangler/state, so the SPA and /api/* share one origin offline.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cloudflare(),
    // Client environment only: the Worker bundle has no use for a service worker.
    ...VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "icon.svg"],
      manifest: {
        name: "fintrack",
        short_name: "fintrack",
        description: "Where every rupee goes, from your bank SMS.",
        lang: "en-IN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "Quick add", url: "/?add=1", icons: [{ src: "pwa-192x192.png", sizes: "192x192" }] },
          { name: "Review inbox", url: "/activity/review", icons: [{ src: "pwa-192x192.png", sizes: "192x192" }] },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
        cleanupOutdatedCaches: true,
        // Web push: show notifications and open the right screen on tap (public/push-sw.js).
        importScripts: ["/push-sw.js"],
        runtimeCaching: [
          {
            // Last-known numbers when offline; always fresh when online.
            urlPattern: ({ url, request }) => url.pathname.startsWith("/api/") && request.method === "GET" && !url.pathname.startsWith("/api/export"),
            handler: "NetworkFirst",
            options: { cacheName: "api", networkTimeoutSeconds: 5, expiration: { maxEntries: 60, maxAgeSeconds: 7 * 86_400 } },
          },
        ],
      },
    }).map((plugin) => ({ ...plugin, applyToEnvironment: (env: { name: string }) => env.name === "client" })),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
});
