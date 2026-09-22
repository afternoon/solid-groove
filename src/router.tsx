import { createRouter } from "@solidjs/router";
import { lazy } from "solid-js";
import IndexPage from "./routes/index";

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
 * Every page but the landing page stays `lazy`, so each route is still its own
 * chunk, exactly as file-based routing gave us for free. The landing page is
 * the one surface with a first-paint budget (PRD `PRJ-06`) and the one that is
 * prerendered into the shell, so it is eager instead -- see the note on its
 * entry below. Nothing about that puts the dashboard's Firebase graph on the
 * landing path: that separation comes from the dashboard's own chunk, and from
 * the landing page reaching `authService` through a dynamic `import()`.
 */
export const Router = createRouter({
  routes: [
    // The one route that is NOT lazy. `src/Document.tsx` prerenders this page
    // into `index.html`, and prerendered markup is only worth having if it is
    // styled and replaced in one frame: as a lazy route its stylesheet lived in
    // a chunk that first paint could not wait for, so the static copy flashed
    // unstyled and then flashed again through the loading fallback before the
    // live page arrived. Eager, its CSS is in the entry graph's stylesheet --
    // already in the shell's `<head>` -- and `App` can drop the static copy the
    // moment the live tree renders. The cost is this page's few kilobytes in
    // the entry chunk on every route, which is the smaller of the two.
    { path: "/", component: IndexPage },
    { path: "/dashboard", component: lazy(() => import("./routes/dashboard")) },
    {
      path: "/projects/:id",
      component: lazy(() => import("./routes/projects/Project")),
    },
    { path: "*404", component: lazy(() => import("./routes/CatchAll")) },
  ],
});
