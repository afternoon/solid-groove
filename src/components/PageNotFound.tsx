import type { Component } from "solid-js";
import NotFound from "./NotFound";

type PageNotFoundProps = {
	/** Optional call-to-action link back into the app. Defaults to the dashboard. */
	homeHref?: string;
};

/**
 * Shown when a URL doesn't match any route in the app. See NotFound for the
 * shared illustration and layout.
 */
const PageNotFound: Component<PageNotFoundProps> = (props) => (
	<NotFound
		code="404"
		title="This page doesn't exist"
		message="The address might be mistyped, or the page may have moved."
		homeHref={props.homeHref}
	/>
);

export default PageNotFound;
