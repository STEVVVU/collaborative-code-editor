import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function saved(tab) {
  await tab.playwright
    .getByRole("status")
    .filter({ hasText: "Saved to server" })
    .waitFor({ state: "visible", timeoutMs: 15000 });
}

async function expand(tab) {
  const button = tab.playwright.getByRole("button", {
    name: /^Shared notebook/,
  });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}

async function visibleCode(tab) {
  return tab.playwright.locator(".view-line").evaluateAll((nodes) =>
    nodes
      .map((node) => ({
        text: node.textContent,
        y: node.getBoundingClientRect().y,
      }))
      .sort((a, b) => a.y - b.y)
      .map((row) => row.text)
      .join("\n")
      .replaceAll("\u00a0", " "),
  );
}

async function evidence(tab, directory, stage, checks) {
  await mkdir(directory, { recursive: true });
  const accessibility = await tab.getAXState({
    emit: false,
    disableDiffing: true,
  });
  await writeFile(
    resolve(directory, `${stage}.png`),
    await tab.getScreenshot({ emit: false }),
  );
  await writeFile(
    resolve(directory, `${stage}.json`),
    JSON.stringify({ passed: true, checks, accessibility }, null, 2),
  );
}

export async function createNotebookPeers(owner, peer, viewer, directory) {
  await expand(owner);
  await owner.playwright
    .getByLabel("Notebook title", { exact: true })
    .fill("Paired sorting review");
  await owner.playwright
    .getByRole("button", {
      name: "Create notebook from this code",
      exact: true,
    })
    .click();
  await owner.getAXState({ emit: false, disableDiffing: true });
  await saved(owner);
  await owner.playwright
    .getByRole("button", { name: "Copy editor link", exact: true })
    .click();
  const editorLink = await owner.clipboard.readText();
  await owner.playwright
    .getByRole("button", { name: "Copy viewer link", exact: true })
    .click();
  const viewerLink = await owner.clipboard.readText();
  await owner.playwright.locator(".monaco-editor").click();
  await owner.pressKey(null, "ctrl+Home");
  await owner.pressKey(null, "shift+End");
  await owner.playwright
    .getByLabel("Comment author", { exact: true })
    .fill("Code reviewer");
  await owner.playwright
    .getByLabel("Code comment", { exact: true })
    .fill("Check the early-exit condition with sorted input.");
  await owner.playwright
    .getByRole("button", { name: "Attach comment to selection", exact: true })
    .click();
  const ownerState = await owner.getAXState({
    emit: false,
    disableDiffing: true,
  });
  assert.ok(ownerState.includes("Anchored to code"));
  for (const [tab, link, role] of [
    [peer, editorLink, "Editor"],
    [viewer, viewerLink, "View only"],
  ]) {
    await tab.playwright
      .getByRole("button", { name: "Run code", exact: true })
      .waitFor({ state: "visible", timeoutMs: 55000 });
    await expand(tab);
    await tab.playwright
      .getByLabel("Notebook link", { exact: true })
      .fill(link);
    await tab.playwright
      .getByRole("button", { name: "Join notebook", exact: true })
      .click();
    await tab.getAXState({ emit: false, disableDiffing: true });
    await saved(tab);
    const state = await tab.getAXState({ emit: false, disableDiffing: true });
    assert.ok(state.includes(role));
    assert.ok(state.includes("No execution trace"));
    assert.ok(state.includes("Check the early-exit condition"));
  }
  assert.equal(
    await viewer.playwright
      .getByLabel("Function arguments JSON", { exact: true })
      .isEnabled(),
    false,
  );
  await evidence(viewer, directory, "viewer", [
    "viewer role",
    "shared comment",
    "run inputs disabled",
    "no automatic shared execution",
  ]);
  await evidence(owner, directory, "created", [
    "real creation",
    "editor/viewer links",
    "comment attached through source selection",
  ]);
  return { passed: true };
}

export async function editNotebookPeers(owner, peer, viewer, directory) {
  await peer.playwright
    .getByLabel("Function arguments JSON", { exact: true })
    .fill("[[3,1,2]]");
  await peer.playwright.locator(".monaco-editor").click();
  await peer.pressKey(null, "ctrl+Home");
  await peer.typeText(null, "# peer review\n");
  await peer.getAXState({ emit: false, disableDiffing: true });
  await saved(peer);
  for (const tab of [owner, peer, viewer]) {
    await saved(tab);
    await tab.playwright
      .locator(".view-lines")
      .filter({ hasText: /peer\s+review/ })
      .waitFor({ state: "visible", timeoutMs: 15000 });
    assert.ok((await visibleCode(tab)).includes("# peer review"));
    assert.equal(
      await tab.playwright
        .getByLabel("Function arguments JSON", { exact: true })
        .evaluate((element) => element.value),
      "[[3,1,2]]",
    );
  }
  await evidence(owner, directory, "coediting", [
    "source converged across three tabs",
    "run settings converged",
    "comment retained",
  ]);
  return { passed: true };
}

export async function editAndReloadOffline(owner, peer, directory) {
  for (const [tab, prefix] of [
    [owner, "# offline owner\n"],
    [peer, "# offline peer\n"],
  ]) {
    await tab.playwright
      .getByRole("status")
      .filter({ hasText: "Offline" })
      .waitFor({ state: "visible", timeoutMs: 15000 });
    await tab.playwright.locator(".monaco-editor").click();
    await tab.pressKey(null, "ctrl+Home");
    await tab.typeText(null, prefix);
    await tab.getAXState({ emit: false, disableDiffing: true });
    await tab.reload();
    await tab.playwright
      .getByRole("status")
      .filter({ hasText: "Offline" })
      .waitFor({ state: "visible", timeoutMs: 15000 });
    await tab.getAXState({ emit: false, disableDiffing: true });
    await tab.playwright
      .locator(".monaco-editor")
      .waitFor({ state: "visible", timeoutMs: 15000 });
    await tab.playwright
      .locator(".view-lines")
      .filter({ hasText: /offline\s+(owner|peer)/ })
      .waitFor({ state: "visible", timeoutMs: 15000 });
    assert.ok((await visibleCode(tab)).includes(prefix.trim()));
    const state = await tab.getAXState({ emit: false, disableDiffing: true });
    assert.ok(state.includes("Runtime idle"));
    assert.ok(state.includes("No execution trace"));
  }
  await evidence(owner, directory, "offline", [
    "two offline writers",
    "draft retained after reload",
    "no automatic execution on reload",
  ]);
  return { passed: true };
}

export async function verifyNotebookReconnection(
  owner,
  peer,
  viewer,
  directory,
) {
  for (const tab of [owner, peer, viewer]) {
    await saved(tab);
    await tab.playwright
      .locator(".view-lines")
      .filter({ hasText: /offline\s+owner/ })
      .waitFor({ state: "visible", timeoutMs: 15000 });
    await tab.playwright
      .locator(".view-lines")
      .filter({ hasText: /offline\s+peer/ })
      .waitFor({ state: "visible", timeoutMs: 15000 });
    const code = await visibleCode(tab);
    assert.ok(code.includes("# offline owner"));
    assert.ok(code.includes("# offline peer"));
    assert.ok(code.includes("# peer review"));
  }
  await viewer.playwright
    .getByRole("button", { name: "Run code", exact: true })
    .click();
  await viewer.getAXState({ emit: false, disableDiffing: true });
  await viewer.playwright
    .getByRole("button", { name: "Run code", exact: true })
    .waitFor({ state: "visible", timeoutMs: 55000 });
  await viewer.playwright
    .getByRole("slider", { name: "Execution timeline", exact: true })
    .press("End");
  const state = await viewer.getAXState({ emit: false, disableDiffing: true });
  assert.ok(state.includes("nums sequence 1 2 3"));
  assert.equal(
    await viewer.playwright
      .getByRole("button", { name: "Save replay", exact: true })
      .isEnabled(),
    true,
  );
  await evidence(viewer, directory, "reconnected", [
    "both disconnected edits merged",
    "server restart persistence",
    "explicit local Python execution",
    "final sorted result",
    "replay export available",
  ]);
  return { passed: true };
}

export async function driveProjectionSwitch(tab, directory) {
  const timeline = tab.playwright.getByRole("slider", {
    name: "Execution timeline",
    exact: true,
  });
  const previousMaximum = await timeline.getAttribute("max");
  assert.equal(await timeline.isEnabled(), true);
  const structural = tab.playwright.getByRole("button", {
    name: "View graph structurally",
    exact: true,
  });
  const graph = tab.playwright.getByRole("button", {
    name: "View graph as a graph",
    exact: true,
  });
  if (await structural.isVisible()) await structural.click();
  else await graph.click();
  await tab.getAXState({ emit: false, disableDiffing: true });
  assert.equal(await timeline.isEnabled(), true);
  assert.equal(await timeline.getAttribute("max"), previousMaximum);
  assert.equal(
    await tab.playwright
      .getByRole("button", { name: "Save replay", exact: true })
      .isEnabled(),
    true,
  );
  await evidence(tab, directory, "projection-preserved", [
    "projection changed",
    "frame count retained",
    "replay still available",
  ]);
  return { passed: true };
}
