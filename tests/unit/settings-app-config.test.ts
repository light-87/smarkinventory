import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DEFAULT_APP_CONFIG } from "@/lib/settings/types";
import { readAppConfig, writeAppConfig } from "@/lib/settings/app-config";

/**
 * lib/settings/app-config — the local-disk seam standing in for the not-yet-
 * built `smark_app_settings` table (see that module's header + this
 * package's notes-for-integrator). Backs up/restores whatever the repo's own
 * `.storage/settings/app-config.json` held (if anything) so this suite never
 * clobbers a developer's local dev-server state.
 */

const CONFIG_PATH = resolve(process.cwd(), ".storage", "settings", "app-config.json");
const BACKUP_PATH = `${CONFIG_PATH}.test-backup`;
let hadOriginal = false;

beforeAll(async () => {
  hadOriginal = existsSync(CONFIG_PATH);
  if (hadOriginal) {
    await mkdir(dirname(BACKUP_PATH), { recursive: true });
    await rename(CONFIG_PATH, BACKUP_PATH);
  }
});

afterAll(async () => {
  if (hadOriginal) {
    await rename(BACKUP_PATH, CONFIG_PATH);
  } else {
    await rm(CONFIG_PATH, { force: true });
  }
});

describe("readAppConfig", () => {
  test("returns DEFAULT_APP_CONFIG when no file exists yet", async () => {
    await rm(CONFIG_PATH, { force: true });
    expect(await readAppConfig()).toEqual(DEFAULT_APP_CONFIG);
  });

  test("falls back to defaults on unparsable JSON instead of throwing", async () => {
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, "{ not valid json", "utf8");
    expect(await readAppConfig()).toEqual(DEFAULT_APP_CONFIG);
  });

  test("coerces an unknown/garbage concurrencyDefault back to the default rather than passing it through", async () => {
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify({ concurrencyDefault: "ludicrous" }), "utf8");
    const config = await readAppConfig();
    expect(config.concurrencyDefault).toBe(DEFAULT_APP_CONFIG.concurrencyDefault);
  });
});

describe("writeAppConfig", () => {
  test("merges the patch over current config and persists it (round-trips through readAppConfig)", async () => {
    await rm(CONFIG_PATH, { force: true });

    const written = await writeAppConfig({ concurrencyDefault: "thorough", lowStockDefaultThreshold: 25 });
    expect(written).toEqual({ labelSize: "avery_l7651", concurrencyDefault: "thorough", lowStockDefaultThreshold: 25 });

    const reread = await readAppConfig();
    expect(reread).toEqual(written);

    const onDisk = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    expect(onDisk).toEqual(written);
  });

  test("a second partial write only touches the given keys", async () => {
    await writeAppConfig({ concurrencyDefault: "economy" });
    const config = await readAppConfig();
    expect(config.concurrencyDefault).toBe("economy");
    expect(config.lowStockDefaultThreshold).toBe(25); // untouched by this write
  });
});
