/**
 * Public page templates (GRW-P1-E hook, filled by GRW-P1-F). Importing this file registers every template; the SSR entry and the client entry both import
 * it through PublicApp, so server and client always render the same tree. One file per family: home, listings, entities (doctor, clinic), partners, errors.
 */
import "./home";
import "./listing";
import "./entity";
import "./partner";
import "./not-found";
