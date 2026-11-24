/** Façade for the propagation monitor (GRW-P1-K): other modules that READ a growth config (the public site renderer, the widget host) report which version they serve. Leaf: Prisma and env only. */
export { ConfigReaders, READER_REFRESH_MS } from './config/config-readers';
