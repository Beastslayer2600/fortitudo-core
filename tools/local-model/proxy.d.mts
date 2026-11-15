import type { Server } from "node:http";

/** The proxy server, for tests. Listens on its own unless PROXY_NO_LISTEN=1. */
export const server: Server;
