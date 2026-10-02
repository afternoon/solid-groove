import { describe, expect, it } from "vitest";
import { songEndSeconds } from "../../audio/renderLength";
import { WAV_HEADER_BYTES } from "../../audio/wavEncoder";
import { createSliceFixtureProject } from "../../domain/fixtures";
import { buildAudioProjection } from "../../projection/audioProjection";
import { estimateStereoBytes } from "./exportFacts";
import { projectSampleRate } from "./stereoExport";

describe("estimateStereoBytes", () => {
  // #836: the dialog said 10 MiB for a 4-bar song whose WAV is 2.2 MB, because
  // it sized the file with 30 s of possible release tail on top of the song.
  it("is the WAV a render with no tail past the song writes: 24-bit stereo, song length", () => {
    const project = createSliceFixtureProject();
    const seconds = songEndSeconds(buildAudioProjection(project));
    const frames = Math.round(seconds * projectSampleRate(project));
    expect(estimateStereoBytes(project)).toBe(WAV_HEADER_BYTES + frames * 2 * 3);
  });
});
