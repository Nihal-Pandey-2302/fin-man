import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// `npx pwa-assets-generator` → PNG icons, maskable icon, apple-touch-icon and favicon from public/icon.svg.
export default defineConfig({
  preset: { ...minimal2023Preset, maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: "#0a0a0a" } } },
  images: ["public/icon.svg"],
});
