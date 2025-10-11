import { describe, expect, it } from "vitest";
import mockProjectData from "./mockProjectData";
import type { Project } from "./types";

describe("Project Types", () => {
	it("should parse raw JavaScript object into Project type", () => {
		const project: Project = mockProjectData;
		expect(project.id).toBe("nn-ts");
		expect(project.latestSnapshot?.song?.tempo).toBeDefined();
		expect(project.latestSnapshot?.song?.tempo).toBe(125);
	});
});
