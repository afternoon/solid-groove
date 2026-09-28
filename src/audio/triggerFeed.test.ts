import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteTrigger } from "../domain/entities";
import type { PadId, TrackId } from "../domain/ids";
import { createTriggerFeed } from "./triggerFeed";

const drums = "trk_drums" as TrackId;
const bass = "trk_bass" as TrackId;
const kick: NoteTrigger = { kind: "pad", padId: "pad_kick" as PadId };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createTriggerFeed (#447)", () => {
  it("delivers a track's triggers to its subscribers once they are heard", () => {
    const feed = createTriggerFeed();
    const heard = vi.fn();
    const other = vi.fn();
    feed.subscribe(drums, heard);
    feed.subscribe(bass, other);

    feed.publish(drums, kick, 0.1);
    expect(heard).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(heard).toHaveBeenCalledExactlyOnceWith(kick);
    expect(other).not.toHaveBeenCalled();
  });

  it("drops a waiting delivery when its subscriber unsubscribes", () => {
    const feed = createTriggerFeed();
    const heard = vi.fn();
    const stop = feed.subscribe(drums, heard);
    feed.publish(drums, kick, 0.1);
    stop();
    stop();
    vi.advanceTimersByTime(200);
    feed.publish(drums, kick, 0);
    vi.advanceTimersByTime(1);
    expect(heard).not.toHaveBeenCalled();
  });

  it("cancels waiting deliveries but keeps subscribers across a graph change", () => {
    const feed = createTriggerFeed();
    const heard = vi.fn();
    feed.subscribe(drums, heard);
    feed.publish(drums, kick, 0.1);
    feed.cancelPending();
    vi.advanceTimersByTime(200);
    expect(heard).not.toHaveBeenCalled();

    feed.publish(drums, kick, 0);
    vi.advanceTimersByTime(1);
    expect(heard).toHaveBeenCalledOnce();
  });

  it("drops everything on dispose", () => {
    const feed = createTriggerFeed();
    const heard = vi.fn();
    feed.subscribe(drums, heard);
    feed.publish(drums, kick, 0.1);
    feed.dispose();
    feed.publish(drums, kick, 0);
    vi.advanceTimersByTime(200);
    expect(heard).not.toHaveBeenCalled();
  });
});
