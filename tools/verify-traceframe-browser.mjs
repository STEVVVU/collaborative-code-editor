import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Run with an already-open supported CUA tab on the isolated verification server. */
export async function driveExecutionBaseline(tab, evidenceDirectory) {
  const output = resolve(evidenceDirectory);
  await mkdir(output, { recursive: true });
  const actions = [];
  const result = { feature: "execution", passed: false };
  try {
    await tab.getAXState({ emit: false, disableDiffing: true });
    await tab.playwright
      .getByRole("button", { name: "Run code", exact: true })
      .waitFor({ state: "visible", timeoutMs: 55000 });
    await tab.playwright
      .getByLabel("Example program", { exact: true })
      .selectOption("bubble-sort");
    await tab.getAXState({ emit: false, disableDiffing: true });
    await tab.playwright
      .getByLabel("Function arguments JSON", { exact: true })
      .fill("[[3,1,2]]");
    await tab.playwright
      .getByRole("button", { name: "Run code", exact: true })
      .click();
    actions.push({ action: "run", input: [[3, 1, 2]] });
    await tab.getAXState({ emit: false, disableDiffing: true });
    await tab.playwright
      .getByRole("button", { name: "Run code", exact: true })
      .waitFor({ state: "visible", timeoutMs: 55000 });
    await tab.playwright
      .getByRole("slider", { name: "Execution timeline", exact: true })
      .press("End");
    const state = await tab.getAXState({ emit: false, disableDiffing: true });
    actions.push({ action: "final-frame", accessibility: state });
    if (!state.includes("nums sequence 1 2 3"))
      throw new Error("Final rendered trace does not contain sorted values");
    if (
      !(await tab.playwright
        .getByRole("button", { name: "Save replay", exact: true })
        .isEnabled())
    )
      throw new Error("Replay export is unavailable");
    await writeFile(
      resolve(output, "execution.png"),
      await tab.getScreenshot({ emit: false }),
    );
    result.passed = true;
    return result;
  } catch (error) {
    result.error = error.message;
    throw error;
  } finally {
    await writeFile(
      resolve(output, "browser-actions.json"),
      JSON.stringify(actions, null, 2),
    );
    await writeFile(
      resolve(output, "browser-result.json"),
      JSON.stringify(result, null, 2),
    );
  }
}
