import { describe, expect, test } from "bun:test";

import {
  CMAKE_MIN_VERSION,
  CMAKE_PINNED_VERSION,
  compareVersions,
  expandValue,
  mergePath,
  parseCmakeVersion,
  setEnv,
  splitPath,
} from "./toolchain.mjs";

describe("splitPath", () => {
  test("drops blanks and unquotes entries Windows stores quoted", () => {
    expect(splitPath('C:\\a;;"C:\\Program Files\\CMake\\bin";C:\\b')).toEqual([
      "C:\\a",
      "C:\\Program Files\\CMake\\bin",
      "C:\\b",
    ]);
  });

  test("tolerates a missing PATH", () => {
    expect(splitPath(undefined)).toEqual([]);
    expect(splitPath("")).toEqual([]);
  });
});

describe("mergePath", () => {
  test("puts repaired entries first", () => {
    expect(mergePath("C:\\a;C:\\b", ["C:\\new"])).toBe("C:\\new;C:\\a;C:\\b");
  });

  test("never duplicates, case-insensitively on Windows", () => {
    expect(mergePath("C:\\A;C:\\b", ["C:\\a"])).toBe("C:\\a;C:\\b");
  });

  test("repairing an already-correct PATH changes nothing", () => {
    expect(mergePath("C:\\a;C:\\b", ["C:\\a"])).toBe("C:\\a;C:\\b");
  });
});

describe("setEnv", () => {
  test("overwrites an existing key instead of adding a PATH/Path twin", () => {
    const env = { Path: "old", HOME: "/h" };
    setEnv(env, "PATH", "new");
    expect(env).toEqual({ Path: "new", HOME: "/h" });
    expect(Object.keys(env)).toHaveLength(2);
  });

  test("adds the key when it is genuinely absent", () => {
    const env = { HOME: "/h" };
    setEnv(env, "VULKAN_SDK", "C:\\VulkanSDK");
    expect(env.VULKAN_SDK).toBe("C:\\VulkanSDK");
  });
});

describe("expandValue", () => {
  test("substitutes known vars and leaves unknown ones intact", () => {
    expect(expandValue("%SystemRoot%\\System32", { SystemRoot: "C:\\Win" })).toBe("C:\\Win\\System32");
    expect(expandValue("%Nope%\\x", {})).toBe("%Nope%\\x");
  });

  test("tolerates an absent value", () => {
    expect(expandValue(undefined, {})).toBe("");
  });
});

describe("parseCmakeVersion", () => {
  test("reads the version from cmake --version output", () => {
    expect(parseCmakeVersion("cmake version 3.31.8\n\nCMake suite maintained and supported by Kitware")).toBe("3.31.8");
  });

  test("reads a four-component version", () => {
    expect(parseCmakeVersion("cmake version 4.4.3")).toBe("4.4.3");
  });

  test("returns null instead of guessing", () => {
    expect(parseCmakeVersion("cmake: command not found")).toBeNull();
    expect(parseCmakeVersion("")).toBeNull();
    expect(parseCmakeVersion(undefined)).toBeNull();
  });
});

describe("compareVersions", () => {
  test("orders versions numerically, not lexically", () => {
    expect(compareVersions("3.9.0", "3.10.0")).toBe(-1);
    expect(compareVersions("3.31.8", "4.0.0")).toBe(-1);
    expect(compareVersions("4.4.3", "3.31.8")).toBe(1);
    expect(compareVersions("3.19", "3.19.0")).toBe(0);
  });

  test("handles components of differing length", () => {
    expect(compareVersions("3.19", "3.19.1")).toBe(-1);
    expect(compareVersions("4", "3.19.8")).toBe(1);
  });
});

describe("version constants", () => {
  test("the pinned version satisfies the floor this tree needs", () => {
    expect(compareVersions(CMAKE_PINNED_VERSION, CMAKE_MIN_VERSION)).toBeGreaterThanOrEqual(0);
  });
});
