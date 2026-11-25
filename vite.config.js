import { defineConfig } from "vite";
import { attachLuckyGrabWS, attachShareEndpoint } from "./gameServer.js";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  plugins: [
    {
      name: "hissam-lucky-grab-ws-plugin",
      configureServer(server) {
        attachShareEndpoint(server.middlewares, "5173");
        attachLuckyGrabWS(server.httpServer);
      },
      configurePreviewServer(server) {
        attachShareEndpoint(server.middlewares, "4173");
        attachLuckyGrabWS(server.httpServer);
      },
    },
  ],
});
