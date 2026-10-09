import { describe, expect, it } from "vitest";
import { deviceTypes } from "../domain/devices";
import { ID_PREFIXES, idPattern } from "../domain/ids";
import { bareParameterId, SYNTH_PARAMETERS } from "../domain/parameters";
import {
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_SYSTEM_PROMPT,
  describeParameter,
  exampleId,
} from "./prompt";

describe("the assistant's system prompt", () => {
  it("is versioned by date", () => {
    expect(ASSISTANT_PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("lists every device type and every one of its parameters by key", () => {
    for (const device of deviceTypes()) {
      const line = ASSISTANT_SYSTEM_PROMPT.split("\n").find((candidate) =>
        candidate.startsWith(`- ${device.type} (`),
      );
      expect(line, device.type).toBeDefined();
      for (const parameter of device.parameters) {
        expect(line).toContain(describeParameter(parameter));
      }
    }
  });

  it("lists the synth's parameters by key", () => {
    for (const parameter of SYNTH_PARAMETERS) {
      expect(ASSISTANT_SYSTEM_PROMPT).toContain(`${bareParameterId(parameter.id)} `);
    }
  });

  it("gives example IDs in exactly the shape the tools accept", () => {
    const id = exampleId(ID_PREFIXES.track, "bass", 1);
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(id);
    expect(id).toMatch(idPattern("track"));
    expect(exampleId(ID_PREFIXES.event, "bass", 12)).toMatch(idPattern("event"));
  });

  it("puts the request ahead of genre habits (PRD principle 10)", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("a starting point, never a rule");
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/follow (the )?genre conventions/i);
  });
});
