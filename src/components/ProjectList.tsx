import { A } from "@solidjs/router";
import since from "since-time-ago";
import { For, type JSX, Show } from "solid-js";
import type { ProjectMetadata } from "../domain/entities";

type ProjectListProps = {
	projects: ProjectMetadata[];
};

export default function ProjectList(props: ProjectListProps): JSX.Element {
	return (
		<div class="project-list">
			<Show
				when={props.projects.length > 0}
				fallback={
					<div class="empty-projects">
						<p class="empty-projects-title">No projects yet</p>
						<p class="empty-projects-hint">
							Create your first one to get started.
						</p>
					</div>
				}
			>
				<For each={props.projects}>
					{(project) => (
						<div class="project-card">
							<p class="project-title">
								<A href={`/projects/${project.id}`}>{project.name}</A>
							</p>
							<p class="project-meta">
								<span>Created {since(new Date(project.createdAt))}</span>
							</p>
						</div>
					)}
				</For>
			</Show>
		</div>
	);
}
