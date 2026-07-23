import { A } from "@solidjs/router";
import since from "since-time-ago";
import { For, Show } from "solid-js";

export default function ProjectList(props) {
	return (
		<div class="project-list">
			<Show
				when={props.projects.length > 0}
				fallback={
					<p class="empty-projects">
						No projects yet. Create your first one to get started.
					</p>
				}
			>
				<For each={props.projects}>
					{(project) => (
						<div class="project-card">
							<p class="project-title">
								<A href={`/projects/${project.id}`}>
									<Show when={project.name} fallback="Untitled Project">
										{project.name}
									</Show>
								</A>
							</p>
							<p class="project-meta">
								<Show when={project.isPublic !== undefined}>
									<span
										class="project-badge"
										classList={{ "is-public": project.isPublic }}
									>
										{project.isPublic ? "Public" : "Private"}
									</span>
								</Show>
								<Show when={project.createdAt}>
									<span>Created {since(project.createdAt.toDate())}</span>
								</Show>
							</p>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
}
