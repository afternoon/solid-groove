import type { Component } from "solid-js";
import NotFound from "./NotFound";

type ProjectNotFoundProps = {
  /** Optional call-to-action link back into the app. Defaults to the dashboard. */
  homeHref?: string;
};

/**
 * Shown when a project does not exist or the current user is not allowed to
 * open it. See NotFound for the shared illustration and layout.
 */
const ProjectNotFound: Component<ProjectNotFoundProps> = (props) => (
  <NotFound
    code="404"
    title="This groove is broken"
    message="We couldn't find this project — it may have been deleted, or you might not have access to it."
    homeHref={props.homeHref}
  />
);

export default ProjectNotFound;
