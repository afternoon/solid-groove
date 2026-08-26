import { createRouter } from "@solidjs/router";
import { lazy } from "solid-js";

/**
 * The application's route table.
 *
 * This file exists because Solid 2 has no file-system routing for this stack.
 * `<FileRoutes />` came from `@solidjs/start/router`, and SolidStart has no
 * Solid 2 release -- its serving layer is now a mode of `@solidjs/vite-plugin`
 * (see `vite.config.ts`). Router 2 does ship a `fileRoutes()` adapter in
 * `@solidjs/router/fs`, but it consumes a `virtual:file-routes` manifest that
 * the Vite plugin does not emit, so there is nothing for it to read. Four
 * routes are cheaper to write down than a manifest generator is to maintain.
 *
 * The route table is also why the page modules under `src/routes/` no longer
 * use `[id]`/`[...404]` filenames: that syntax was addressed to `FileRoutes`,
 * and with nothing reading it, it only suggested a convention the app no
 * longer has. The patterns live here instead, where they are matched.
 *
 * Every page stays `lazy` so each route is still its own chunk, exactly as
 * file-based routing gave us for free. The landing page is the one surface
 * with a first-paint budget (PRD `PRJ-06`), and keeping it in its own chunk is
 * what keeps the dashboard's Firebase graph off that path.
 */
export const Router = createRouter({
  routes: [
    { path: "/", component: lazy(() => import("./routes/index")) },
    { path: "/dashboard", component: lazy(() => import("./routes/dashboard")) },
    {
      path: "/projects/:id",
      component: lazy(() => import("./routes/projects/Project")),
    },
    { path: "*404", component: lazy(() => import("./routes/CatchAll")) },
  ],
});
