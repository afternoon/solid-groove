import { describe, expect, it } from "vitest";
import { insertChain, masterChain, returnChain } from "../commands";
import type { DeviceId, ReturnId, TrackId } from "../domain/ids";
import { deviceParameterTarget } from "./deviceControlModel";

const deviceId = "dev_1" as DeviceId;

describe("deviceParameterTarget", () => {
  it("addresses a track's insert through trackDevice", () => {
    const trackId = "trk_1" as TrackId;
    expect(deviceParameterTarget(insertChain(trackId), deviceId, "size")).toEqual({
      scope: "trackDevice",
      trackId,
      deviceId,
      parameterId: "size",
    });
  });

  it("addresses the master's device through masterDevice", () => {
    expect(deviceParameterTarget(masterChain, deviceId, "drive")).toEqual({
      scope: "masterDevice",
      deviceId,
      parameterId: "drive",
    });
  });

  it("refuses a return bus, which has no device parameter scope", () => {
    expect(() =>
      deviceParameterTarget(returnChain("ret_1" as ReturnId), deviceId, "size"),
    ).toThrow();
  });
});
