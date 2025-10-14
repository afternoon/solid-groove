import { A } from "@solidjs/router";
import since from "since-time-ago";
import { For, Show } from "solid-js";

export default function ProjectList(props) {
	return (
		<div class="project-list">
			<For each={props.projects}>
				{(project) => (
					<div class="project-item">
						<p class="project-title">
							<A href={`/projects/${project.id}`}>
								<Show when={project.name} fallback="Untitled Project">
									{project.name}
								</Show>
							</A>
						</p>
						<Show when={project.createdAt}>
							<p>Created {since(project.createdAt.toDate())}</p>
						</Show>
						<Show when={project.isPublic !== undefined}>
							<p>{project.isPublic ? "Public" : "Private"}</p>
						</Show>
					</div>
				)}
			</For>
		</div>
	);
}
