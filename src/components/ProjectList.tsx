import { useNavigate } from "@solidjs/router";
import since from "since-time-ago";
import { For, Show } from "solid-js";

export default function ProjectList(props) {
	const navigate = useNavigate();

	return (
		<div class="project-list">
			<For each={props.projects}>
				{(project) => (
					<div
						class="project-item"
						onClick={() => navigate(`/projects/${project.id}`)}
					>
						<p class="project-title">
							<Show when={project.name} fallback="Untitled Project">
								{project.name}
							</Show>
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
