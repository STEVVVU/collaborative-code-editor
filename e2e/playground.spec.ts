import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const editedNestedBfsSource = `class BatchMetadata:
    pass

def inspect_networks(state):
    for batch in state['batches']:
        batch['distances'] = {}
        for name, graph in batch['graphs'].items():
            distances = [-1] * len(graph)
            queue = []
            if graph:
                distances[0] = 0
                queue.append(0)
            while queue:
                node = queue.pop(0)
                for neighbor in graph[node]:
                    if distances[neighbor] == -1:
                        distances[neighbor] = distances[node] + 1
                        queue.append(neighbor)
            batch['distances'][name] = distances
    return state
`;

const editedNestedBfsArguments = JSON.stringify([{
  batches: [
    {
      label: "connected",
      graphs: {
        chain: [[1], [0, 2], [1, 3], [2, 4], [3]],
        cycle: [[1, 3], [0, 2], [1, 3], [0, 2]],
      },
    },
    {
      label: "mixed",
      graphs: {
        star: [[1, 2, 3, 4], [0], [0], [0], [0]],
        disconnected: [[1], [0, 2], [1], [4], [3], []],
      },
    },
  ],
}]);

async function setEditorSource(
  page: import("@playwright/test").Page,
  source: string,
) {
  await page.evaluate((value) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(value);
  }, source);
}

async function waitForTrace(
  page: import("@playwright/test").Page,
  path = "/",
) {
  await page.goto(path);
  await expect(page.locator(".visual-scene")).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel("Execution timeline")).toBeEnabled();
}

async function expandObjectRelationships(page: import("@playwright/test").Page) {
  const expand = page.getByRole("button", { name: "Expand object relationships" });
  if (await expand.count()) await expand.click();
}

interface CorpusCase {
  id: string;
  projection: string;
  minimumCount?: number;
  recursiveDepth?: number;
}

const problemCorpus: CorpusCase[] = [
  { id: "bubble-sort", projection: ".sequence-cell", minimumCount: 5 },
  { id: "grid-walk", projection: ".grid-cell", minimumCount: 9 },
  { id: "two-sum", projection: ".mapping-row", minimumCount: 1 },
  {
    id: "two-pointer-scan",
    projection: ".sequence-cell",
    minimumCount: 6,
  },
  { id: "bfs", projection: ".graph-node", minimumCount: 6 },
  { id: "linked-list", projection: ".relation-node", minimumCount: 3 },
  {
    id: "reverse-linked-list",
    projection: ".relation-node",
    minimumCount: 3,
  },
  { id: "binary-tree", projection: ".relation-node", minimumCount: 6 },
  { id: "invert-tree", projection: ".relation-node", minimumCount: 7 },
  {
    id: "factorial",
    projection: ".scalar-value",
    recursiveDepth: 5,
  },
  { id: "cyclic-list", projection: ".relation-node", minimumCount: 2 },
  {
    id: "nested-structures",
    projection: ".visual-scene .attention-context-card",
    minimumCount: 3,
  },
];

interface ExtendedCorpusCase {
  id: string;
  source: string;
  entrypoint: string;
  arguments: string;
  expectedReturn: string;
  projection: string;
  minimumProjectionCount?: number;
  minimumDepth?: number;
  viewAsGraph?: string;
}

const extendedAlgorithmCorpus: ExtendedCorpusCase[] = [
  {
    id: "binary-search",
    source: `def solve(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:
        middle = (left + right) // 2
        if nums[middle] == target:
            return middle
        if nums[middle] < target:
            left = middle + 1
        else:
            right = middle - 1
    return -1`,
    entrypoint: "solve",
    arguments: "[[1,3,5,7,9],7]",
    expectedReturn: "3",
    projection: ".sequence-cell",
    minimumProjectionCount: 5,
  },
  {
    id: "sliding-window",
    source: `def solve(nums, size):
    window = sum(nums[:size])
    best = window
    for right in range(size, len(nums)):
        window += nums[right] - nums[right - size]
        best = max(best, window)
    return best`,
    entrypoint: "solve",
    arguments: "[[2,1,5,1,3,2],3]",
    expectedReturn: "9",
    projection: ".sequence-cell",
    minimumProjectionCount: 6,
  },
  {
    id: "merge-sort",
    source: `def solve(nums):
    if len(nums) <= 1:
        return nums
    middle = len(nums) // 2
    left = solve(nums[:middle])
    right = solve(nums[middle:])
    merged = []
    i = j = 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            merged.append(left[i]); i += 1
        else:
            merged.append(right[j]); j += 1
    return merged + left[i:] + right[j:]`,
    entrypoint: "solve",
    arguments: "[[5,2,4,1,3]]",
    expectedReturn: "12345",
    projection: ".sequence-cell",
    minimumProjectionCount: 5,
    minimumDepth: 3,
  },
  {
    id: "quick-sort",
    source: `def solve(nums):
    def partition(low, high):
        pivot = nums[high]
        store = low
        for index in range(low, high):
            if nums[index] <= pivot:
                nums[store], nums[index] = nums[index], nums[store]
                store += 1
        nums[store], nums[high] = nums[high], nums[store]
        return store
    def quick(low, high):
        if low >= high:
            return
        pivot = partition(low, high)
        quick(low, pivot - 1)
        quick(pivot + 1, high)
    quick(0, len(nums) - 1)
    return nums`,
    entrypoint: "solve",
    arguments: "[[5,2,4,1,3]]",
    expectedReturn: "12345",
    projection: ".sequence-cell",
    minimumProjectionCount: 5,
    minimumDepth: 3,
  },
  {
    id: "monotonic-stack",
    source: `def solve(nums):
    answer = [-1] * len(nums)
    stack = []
    for index, value in enumerate(nums):
        while stack and nums[stack[-1]] < value:
            answer[stack.pop()] = value
        stack.append(index)
    return answer`,
    entrypoint: "solve",
    arguments: "[[2,1,2,4,3]]",
    expectedReturn: "424-1-1",
    projection: ".sequence-cell",
    minimumProjectionCount: 5,
  },
  {
    id: "heap-top-k",
    source: `def solve(nums, k):
    heap = []
    for value in nums:
        heappush(heap, value)
        if len(heap) > k:
            heappop(heap)
    return sorted(heap)`,
    entrypoint: "solve",
    arguments: "[[5,1,4,2,3],2]",
    expectedReturn: "45",
    projection: ".sequence-cell",
    minimumProjectionCount: 2,
  },
  {
    id: "dijkstra",
    source: `def solve(n, edges):
    graph = [[] for _ in range(n)]
    weights = {}
    for start, end, cost in edges:
        graph[start].append(end)
        weights[(start, end)] = cost
    distance = [10**9] * n
    distance[0] = 0
    heap = [(0, 0)]
    while heap:
        cost, node = heappop(heap)
        if cost != distance[node]:
            continue
        for neighbor in graph[node]:
            weight = weights[(node, neighbor)]
            candidate = cost + weight
            if candidate < distance[neighbor]:
                distance[neighbor] = candidate
                heappush(heap, (candidate, neighbor))
    return distance`,
    entrypoint: "solve",
    arguments: "[4,[[0,1,2],[0,2,5],[1,2,1],[1,3,4],[2,3,1]]]",
    expectedReturn: "0234",
    projection: ".graph-node",
    minimumProjectionCount: 4,
    viewAsGraph: "graph",
  },
  {
    id: "topological-sort",
    source: `def solve(n, edges):
    graph = [[] for _ in range(n)]
    indegree = [0] * n
    for start, end in edges:
        graph[start].append(end)
        indegree[end] += 1
    queue = deque(node for node in range(n) if indegree[node] == 0)
    order = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for neighbor in graph[node]:
            indegree[neighbor] -= 1
            if indegree[neighbor] == 0:
                queue.append(neighbor)
    return order`,
    entrypoint: "solve",
    arguments: "[4,[[0,1],[0,2],[1,3],[2,3]]]",
    expectedReturn: "0123",
    projection: ".graph-node",
    minimumProjectionCount: 4,
    viewAsGraph: "graph",
  },
  {
    id: "union-find",
    source: `def solve(n, edges):
    parent = list(range(n))
    size = [1] * n
    def find(node):
        while node != parent[node]:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node
    for left, right in edges:
        a, b = find(left), find(right)
        if a != b:
            if size[a] < size[b]:
                a, b = b, a
            parent[b] = a
            size[a] += size[b]
    return find(0) == find(n - 1)`,
    entrypoint: "solve",
    arguments: "[5,[[0,1],[1,2],[3,4],[2,4]]]",
    expectedReturn: "true",
    projection: ".sequence-cell",
    minimumProjectionCount: 5,
    minimumDepth: 2,
  },
  {
    id: "backtracking",
    source: `def solve(nums):
    result = []
    path = []
    def visit(index):
        if index == len(nums):
            result.append(path.copy())
            return
        visit(index + 1)
        path.append(nums[index])
        visit(index + 1)
        path.pop()
    visit(0)
    return len(result)`,
    entrypoint: "solve",
    arguments: "[[1,2,3]]",
    expectedReturn: "8",
    projection: ".sequence-cell",
    minimumProjectionCount: 3,
    minimumDepth: 4,
  },
  {
    id: "tabulation-dp",
    source: `def solve(rows, columns):
    dp = [[0] * columns for _ in range(rows)]
    for row in range(rows):
        for column in range(columns):
            if row == 0 or column == 0:
                dp[row][column] = 1
            else:
                dp[row][column] = dp[row - 1][column] + dp[row][column - 1]
    return dp[-1][-1]`,
    entrypoint: "solve",
    arguments: "[3,4]",
    expectedReturn: "10",
    projection: ".grid-cell",
    minimumProjectionCount: 12,
  },
  {
    id: "trie",
    source: `def solve(words, query):
    root = {}
    for word in words:
        node = root
        for character in word:
            node = node.setdefault(character, {})
        node["$"] = True
    node = root
    for character in query:
        if character not in node:
            return False
        node = node[character]
    return "$" in node`,
    entrypoint: "solve",
    arguments: '[["cat","car","dog"],"car"]',
    expectedReturn: "true",
    projection: ".mapping-row",
    minimumProjectionCount: 2,
  },
];

test("executes a representative algorithm and data-structure corpus", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The corpus is executor coverage; responsive behavior has separate tests.",
  );
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await waitForTrace(page);

  for (const problem of problemCorpus) {
    await test.step(problem.id, async () => {
      await page.getByLabel("Example program").selectOption(problem.id);
      await page.getByRole("button", { name: "Run code" }).click();
      await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
        timeout: 30_000,
      });
      await expect(page.locator(".error-banner")).toHaveCount(0);

      const timeline = page.getByLabel("Execution timeline");
      await expect(timeline).toBeEnabled();
      const maximum = Number(await timeline.getAttribute("max"));
      expect(maximum, `${problem.id} should produce multiple trace frames`)
        .toBeGreaterThan(0);

      let largestProjection = 0;
      let largestCallDepth = 0;
      const sampleIndexes = [
        0,
        Math.floor(maximum / 4),
        Math.floor(maximum / 2),
        Math.floor((maximum * 3) / 4),
        maximum,
      ];
      for (const index of [...new Set(sampleIndexes)]) {
        await timeline.fill(String(index));
        await expect(page.locator(".visual-scene"))
          .toHaveAttribute("data-frame-index", String(index));
        largestProjection = Math.max(
          largestProjection,
          await page.locator(problem.projection).count(),
        );
        largestCallDepth = Math.max(
          largestCallDepth,
          await page.locator(".call-stack-entry").count(),
        );
        await expect(page.locator(".visual-scene")).toBeVisible();
      }

      if (
        largestProjection < (problem.minimumCount ?? 1) ||
        largestCallDepth < (problem.recursiveDepth ?? 0)
      ) {
        for (let index = 0; index <= maximum; index += 1) {
          await timeline.fill(String(index));
          largestProjection = Math.max(
            largestProjection,
            await page.locator(problem.projection).count(),
          );
          largestCallDepth = Math.max(
            largestCallDepth,
            await page.locator(".call-stack-entry").count(),
          );
          if (
            largestProjection >= (problem.minimumCount ?? 1) &&
            largestCallDepth >= (problem.recursiveDepth ?? 0)
          ) {
            break;
          }
        }
      }

      expect(
        largestProjection,
        `${problem.id} should render its natural projection`,
      ).toBeGreaterThanOrEqual(problem.minimumCount ?? 1);
      if (problem.recursiveDepth) {
        expect(
          largestCallDepth,
          `${problem.id} should preserve recursive call depth`,
        ).toBeGreaterThanOrEqual(problem.recursiveDepth);
      }
      expect(pageErrors, `${problem.id} should not cause page errors`).toEqual([]);
    });
  }
});

test("composes nested graphs inline and retains recursive inspection", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Nested contract composition is covered once at desktop size.",
  );
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForTrace(page, "/?example=nested-graphs");
  await expect(page.getByLabel("Example program"))
    .toHaveValue("nested-graphs");
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  const timeline = page.getByLabel("Execution timeline");
  await timeline.fill(await timeline.getAttribute("max") ?? "0");
  const context = page.getByLabel("Context values");
  const working = page.getByLabel("Working state");
  await expect(context.locator(".attention-preview-graph")).toHaveCount(4);
  expect(await working.locator(".attention-working-card").filter({
    has: page.locator(".graph-viewport"),
  }).count()).toBeLessThanOrEqual(3);
  expect(await page.locator(".visual-scene .graph-viewport").count()).toBeLessThanOrEqual(3);

  await context.locator('.attention-context-card:has(.attention-card-heading strong[title="state"])')
    .getByRole("button", { name: "Inspect state" }).click();
  await expect(page.locator(".detail-view")).toBeVisible();
  await expect(page.locator(".detail-content .graph-viewport")).toHaveCount(4);
  await expect(page.locator(".detail-content .graph-node")).toHaveCount(13);
  await expect(page.locator(".detail-content .grid-cell")).toHaveCount(4);
  await page.locator(
    '.detail-content .projection-shell[data-projection-path="state{1}.value"] .projection-shell-inspect',
  ).click();
  await expect(page.locator(".detail-content .grid-cell")).toHaveCount(4);
  await page.getByRole("button", { name: "Back to parent value" }).click();
  await page.locator(
    '.detail-content .projection-shell.kind-object[data-projection-path="state{2}.value"] > header > .projection-shell-inspect',
  ).click();
  await expect(page.locator(".detail-content .object-fields .object-field"))
    .toHaveCount(2);
  await page.getByRole("button", { name: "Back to parent value" }).click();
  await page.getByRole("button", { name: "Back to execution" }).click();

  await context.locator('.attention-context-card:has(.attention-card-heading strong[title="state"])')
    .getByRole("button", { name: "Inspect state" }).click();
  const firstGraphShell = page.locator(".detail-content .projection-shell.kind-graph").first();
  const graphPath = await firstGraphShell.getAttribute("data-projection-path");
  const collapse = firstGraphShell.getByRole("button", { name: /^Collapse/ });
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await collapse.click();
  await expect(firstGraphShell.getByRole("button", { name: /^Expand/ }))
    .toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".detail-content .graph-viewport")).toHaveCount(3);
  await firstGraphShell.getByRole("button", { name: /^Expand/ }).click();
  await expect(page.locator(".detail-content .graph-viewport")).toHaveCount(4);
  await expect(firstGraphShell).toHaveAttribute("data-projection-path", graphPath ?? "");
  await firstGraphShell.getByRole("button", { name: /^Open details for/ }).click();
  await expect(page.locator(".detail-view")).toBeVisible();
  const renderedNodes = page.locator(".detail-content .graph-node");
  await expect(renderedNodes).toHaveCount(2);
  await expect(page.locator(".detail-content .graph-viewport"))
    .toHaveCSS("opacity", "1");
  await expect(page.locator(".scene-motion-ghost")).toHaveCount(0);
  await expect(page.locator(".detail-view:visible .detail-toolbar .projection-kind"))
    .toHaveClass(/kind-graph/);
  await expect(page.locator(".detail-content .graph-viewport")).toBeVisible();
  await expect(renderedNodes.first()).toBeVisible();
  const renderedEdges = await page.locator(".detail-content .graph-edges line")
    .evaluateAll((edges) => edges.map((edge) => {
      const bounds = edge.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    }));
  expect(renderedEdges.some(({ width, height }) => width > 0 || height > 0))
    .toBe(true);
  await expect(page.locator('.detail-content .graph-node[data-topology-phase="entering"]'))
    .toHaveCount(0);
  const viewportBounds = await page.locator(".detail-content .graph-viewport")
    .evaluate((viewport) => {
      const bounds = viewport.getBoundingClientRect();
      return {
        left: Math.round(bounds.left),
        top: Math.round(bounds.top),
        right: Math.round(bounds.right),
        bottom: Math.round(bounds.bottom),
      };
    });
  const nodeGeometry = await renderedNodes.evaluateAll((nodes) => nodes.map((node) => {
    const bounds = node.getBoundingClientRect();
    return {
      label: node.textContent?.trim(),
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      right: Math.round(bounds.right),
      bottom: Math.round(bounds.bottom),
      opacity: Number(getComputedStyle(node).opacity),
      frontmost: document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      )?.closest(".graph-node") === node,
    };
  }));
  expect(nodeGeometry.map(({ label }) => label)).toEqual(["0", "1"]);
  expect(nodeGeometry.every(({ frontmost }) => frontmost)).toBe(true);
  expect(new Set(nodeGeometry.map(({ x, y }) => `${x}:${y}`)).size)
    .toBe(nodeGeometry.length);
  expect(nodeGeometry.every(({ opacity }) => opacity > 0.9)).toBe(true);
  expect(nodeGeometry.every((node) =>
    node.x >= viewportBounds.left && node.y >= viewportBounds.top &&
    node.right <= viewportBounds.right && node.bottom <= viewportBounds.bottom
  )).toBe(true);
  await expect(page.locator(".detail-view:visible .detail-toolbar .projection-kind"))
    .toHaveClass(/kind-graph/);
  await expect(page.locator(".detail-breadcrumbs")).toBeVisible();
  await expect(pageErrors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("nested-graphs-final-proof.png"),
    animations: "disabled",
    fullPage: false,
  });
});

test("keeps explicit nested graph contracts when editing the example source", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Nested contract persistence is covered once at desktop size.",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForTrace(page, "/?example=nested-graphs");
  await expect(page.getByLabel("Example program")).toHaveValue("nested-graphs");

  await setEditorSource(page, editedNestedBfsSource);
  await page.getByLabel("Function entry point").fill("inspect_networks");
  await page.getByLabel("Function arguments JSON").fill(editedNestedBfsArguments);
  await expect(page.getByLabel("Example program")).toHaveValue("custom");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  const timeline = page.getByLabel("Execution timeline");
  await timeline.fill(await timeline.getAttribute("max") ?? "0");

  const context = page.getByLabel("Context values");
  const working = page.getByLabel("Working state");
  await expect(context.locator(".attention-preview-graph")).toHaveCount(4);
  expect(await working.locator(".attention-full-view .graph-viewport").count())
    .toBeLessThanOrEqual(3);
  await context.locator('.attention-context-card:has(.attention-card-heading strong[title="state"])')
    .getByRole("button", { name: "Inspect state" }).click();
  await expect(page.locator(".detail-content .graph-viewport")).toHaveCount(4);
  await expect(page.locator(".detail-content .graph-node")).toHaveCount(20);
  await page.getByRole("button", { name: "Back to execution" }).click();

  await page.getByLabel("Example program").selectOption("nested-structures");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.getByLabel("Example program")).toHaveValue("nested-structures");
  await expect(page.getByLabel("Context values").locator(".attention-preview-graph"))
    .toHaveCount(0);
});

test("keeps nested BFS attention bounded and distinguishes graph reads from writes", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Nested BFS scene composition is covered once at desktop size.",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForTrace(page, "/?example=nested-bfs");
  await expect(page.getByLabel("Example program")).toHaveValue("nested-bfs");
  const scene = page.locator(".visual-scene");
  const context = page.getByLabel("Context values");
  const working = page.getByLabel("Working state");
  await expect(context).toBeVisible();
  await expect(working).toBeVisible();
  await expect(context.locator(".attention-preview-graph").first()).toBeVisible();

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  // The saved nested-BFS trace identifies step 51 as the observed graph[node] read
  // and step 63 as the first distance-list update caused by that traversal.
  const graphReadIndex = 51;
  const changeIndex = 63;
  expect(maximum).toBeGreaterThan(changeIndex);
  await timeline.fill(String(graphReadIndex));
  await expect(scene).toHaveAttribute("data-frame-index", String(graphReadIndex));
  const readOnlyGraph = working.locator(
    '.attention-working-card.activity-used:has(.attention-full-view .graph-viewport):not(:has(.attention-changed))',
  ).first();
  await expect(readOnlyGraph).toBeVisible();
  const graphReadId = await readOnlyGraph.getAttribute("data-attention-id");
  expect(graphReadId).toBeTruthy();
  expect(await context.locator(".attention-preview-graph").count()).toBeGreaterThan(0);
  expect(await working.locator(
    '.attention-working-card[data-attention-level="full"]:not(:has(.attention-pinned))',
  ).count()).toBeLessThanOrEqual(3);
  await page.screenshot({ path: testInfo.outputPath("attention-nested-bfs-read.png"), animations: "disabled" });

  await timeline.fill(String(changeIndex));
  await expect(scene).toHaveAttribute("data-frame-index", String(changeIndex));
  await expect(working.locator(".attention-changed").first()).toBeVisible();
  expect(await working.locator(
    '.attention-working-card[data-attention-level="full"]:not(:has(.attention-pinned))',
  ).count()).toBeLessThanOrEqual(3);
  await page.screenshot({ path: testInfo.outputPath("attention-nested-bfs-change.png"), animations: "disabled" });

  const automaticIdsAt = async (index: number) => {
    await timeline.fill(String(index));
    await expect(scene).toHaveAttribute("data-frame-index", String(index));
    return working.locator(
      ".attention-working-card:not(:has(.attention-pinned))",
    ).evaluateAll((cards) => cards.map((card) => card.getAttribute("data-attention-id")));
  };
  const readStepIds = await automaticIdsAt(graphReadIndex);
  const changeStepIds = await automaticIdsAt(changeIndex);
  const revisitedReadStepIds = await automaticIdsAt(graphReadIndex);
  const revisitedChangeStepIds = await automaticIdsAt(changeIndex);
  expect(revisitedReadStepIds).toEqual(readStepIds);
  expect(revisitedChangeStepIds).toEqual(changeStepIds);
  expect(readStepIds).toContain(graphReadId);
  await expect(page.locator(".error-banner")).toHaveCount(0);
});

test("uses the same attention behavior for nested board, map, and history values", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Nested attention layout is covered at desktop size.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await waitForTrace(page, "/?example=nested-structures");
  await expect(page.getByLabel("Example program")).toHaveValue("nested-structures");

  const scene = page.locator(".visual-scene");
  const timeline = page.getByLabel("Execution timeline");
  const context = page.getByLabel("Context values");
  const working = page.getByLabel("Working state");
  await expect(context).toBeVisible();
  await expect(working).toBeVisible();
  const allLabels = await page.locator(
    ".attention-card-heading strong, .attention-working-heading strong",
  ).allTextContents();
  const normalizedLabels = allLabels.map((label) => label.replaceAll('"', ""));
  expect(normalizedLabels).toContain("board");
  expect(normalizedLabels).toContain("scores");
  expect(normalizedLabels).toContain("history");

  const maximum = Number(await timeline.getAttribute("max"));
  let changedLabels = new Set<string>();
  let sawUsed = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    await expect(scene).toHaveAttribute("data-frame-index", String(index));
    const fullAutomaticCount = await working.locator(
      '.attention-working-card[data-attention-level="full"]:not(:has(.attention-pinned))',
    ).count();
    expect(fullAutomaticCount).toBeLessThanOrEqual(3);
    sawUsed ||= (await working.locator(".attention-used").count()) > 0;
    for (const card of await working.locator(".attention-working-card:has(.attention-changed)").all()) {
      const label = await card.locator(".attention-working-heading strong").innerText();
      changedLabels.add(label);
    }
    if (sawUsed && ["board", "scores", "history"].every((label) =>
      [...changedLabels].some((changed) => changed.replaceAll('"', "") === label))) {
      await page.screenshot({ path: testInfo.outputPath("attention-nested-structures.png"), animations: "disabled" });
      break;
    }
  }
  expect(sawUsed).toBe(true);
  expect([...changedLabels].map((label) => label.replaceAll('"', ""))).toEqual(
    expect.arrayContaining(["board", "scores", "history"]),
  );

  const rootStateCard = context.locator(
    '.attention-context-card.activity-idle:has(.attention-card-heading strong[title="state"])',
  ).first();
  await expect(rootStateCard).toBeVisible();
  const pinnedId = await rootStateCard.getAttribute("data-attention-id");
  await rootStateCard.getByRole("button", { name: "Inspect state" }).click();
  await expect(page.locator(".detail-view")).toBeVisible();
  await page.getByRole("button", { name: "Back to execution" }).click();
  await expect(page.locator(".visual-scene")).toBeVisible();
  const currentWorkingIds = await working.locator(".attention-working-card").evaluateAll(
    (cards) => cards.map((card) => card.getAttribute("data-attention-id")),
  );
  expect(currentWorkingIds).not.toContain(pinnedId);
  await rootStateCard.getByRole("button", { name: "Pin state" }).click();
  await expect(working.locator(".attention-working-card .attention-pinned")).toHaveCount(1);
  await expect(working.locator(`.attention-working-card[data-attention-id="${pinnedId}"]`)).toBeVisible();
  const timelineMaximum = Number(await timeline.getAttribute("max"));
  await timeline.fill(String(timelineMaximum));
  await expect(scene).toHaveAttribute("data-frame-index", String(timelineMaximum));
  await expect.poll(() => working.locator(".attention-working-card").evaluateAll(
    (cards, id) => cards.some((card) => card.getAttribute("data-attention-id") === id),
    pinnedId,
  )).toBe(true);

  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({ timeout: 30_000 });
  await expect(working.locator(".attention-pinned")).toHaveCount(0);

  const replayPinCard = context.locator(
    '.attention-context-card:has(.attention-card-heading strong[title="state"])',
  ).first();
  await replayPinCard.getByRole("button", { name: "Pin state" }).click();
  await expect(working.locator(".attention-pinned")).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save replay" }).click(),
  ]);
  const replayPath = await download.path();
  expect(replayPath).toBeTruthy();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Open replay" }).click(),
  ]);
  await fileChooser.setFiles(replayPath!);
  await expect(scene).toBeVisible();
  await expect(working.locator(".attention-pinned")).toHaveCount(0);

  await page.getByLabel("Example program").selectOption("two-sum");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({ timeout: 30_000 });
  await expect(working.locator(".attention-pinned")).toHaveCount(0);

  await expect(page.locator("html").evaluate((html) => html.scrollWidth <= html.clientWidth)).resolves.toBe(true);
  const bounds = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".visualizer-wrap")!.getBoundingClientRect();
    const contextBounds = document.querySelector<HTMLElement>('[aria-label="Context values"]')!.getBoundingClientRect();
    const workingBounds = document.querySelector<HTMLElement>('[aria-label="Working state"]')!.getBoundingClientRect();
    return { paneRight: pane.right, contextRight: contextBounds.right, workingRight: workingBounds.right };
  });
  expect(bounds.contextRight).toBeLessThanOrEqual(bounds.paneRight + 1);
  expect(bounds.workingRight).toBeLessThanOrEqual(bounds.paneRight + 1);
  expect(pageErrors).toEqual([]);
});

test("keeps object identity context and attention inside the visual pane", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Object graph geometry is inspected at desktop size.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForTrace(page, "/?example=binary-tree");
  await expect(page.getByLabel("Example program")).toHaveValue("binary-tree");
  const scene = page.locator(".visual-scene");
  const relation = scene.locator(".relation-section");
  const context = page.getByLabel("Context values");
  const working = page.getByLabel("Working state");
  await expect(relation).toBeVisible();
  await expect(relation.getByRole("button", { name: "Expand object relationships" })).toBeVisible();
  await expect(context).toBeVisible();
  await expect(working).toBeVisible();
  await expect(relation.locator(".relation-node")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("attention-object-tree.png"), animations: "disabled" });

  const geometry = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const pane = box(".visualizer-wrap");
    const relationSection = box(".relation-section");
    const attention = box(".attention-workspace");
    return {
      pane,
      relationSection,
      attention,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      sceneScrollWidth: document.querySelector<HTMLElement>(".scene-content")!.scrollWidth,
      sceneClientWidth: document.querySelector<HTMLElement>(".scene-content")!.clientWidth,
      relationNodeCount: document.querySelectorAll(".relation-node").length,
      relationDuplicateCards: [...document.querySelectorAll<HTMLElement>(".attention-context-card, .attention-working-card")]
        .filter((card) => /node/i.test(card.innerText)).length,
    };
  });
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth);
  expect(geometry.relationSection.left).toBeGreaterThanOrEqual(geometry.pane.left - 1);
  expect(geometry.relationSection.right).toBeLessThanOrEqual(geometry.pane.right + 1);
  expect(geometry.attention.left).toBeGreaterThanOrEqual(geometry.pane.left - 1);
  expect(geometry.attention.right).toBeLessThanOrEqual(geometry.pane.right + 1);
  expect(geometry.attention.bottom).toBeLessThanOrEqual(geometry.relationSection.top + 1);
  await relation.getByRole("button", { name: "Expand object relationships" }).click();
  await expect(relation.locator(".relation-node")).toHaveCount(6);
});

test("unknown example URL falls back to the default example", async ({ page }) => {
  await waitForTrace(page, "/?example=not-a-known-example");
  await expect(page.getByLabel("Example program")).toHaveValue("bubble-sort");
});

test("keeps extended algorithm frames useful and visuals semantically correct", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The extended corpus is executor and scene coverage.",
  );
  test.setTimeout(300_000);
  await waitForTrace(page);

  for (const problem of extendedAlgorithmCorpus) {
    await test.step(problem.id, async () => {
      await page.evaluate((source) => {
        const editor = (
          window as typeof window & {
            monaco: {
              editor: {
                getModels(): Array<{ setValue(value: string): void }>;
              };
            };
          }
        ).monaco.editor;
        editor.getModels()[0]?.setValue(source);
      }, problem.source);
      await page.getByLabel("Function entry point").fill(problem.entrypoint);
      await page.getByLabel("Function arguments JSON").fill(problem.arguments);
      await page.getByRole("button", { name: "Run code" }).click();
      await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
        timeout: 30_000,
      });
      await expect(page.locator(".error-banner")).toHaveCount(0);
      const timeline = page.getByLabel("Execution timeline");
      const maximum = Number(await timeline.getAttribute("max"));
      expect(maximum).toBeGreaterThan(0);
      if (problem.viewAsGraph) {
        await timeline.fill(String(maximum));
        const graphView = page.getByRole("button", {
          name: `View ${problem.viewAsGraph} as a graph`,
        });
        if (await graphView.count()) {
          await graphView.click();
        } else {
          await expect(page.getByRole("button", {
            name: `View ${problem.viewAsGraph} structurally`,
          })).toBeVisible();
        }
      }

      let largestProjection = 0;
      let largestDepth = 0;
      let duplicateFrames = 0;
      let previousSignature = "";
      const stride = Math.max(1, Math.ceil((maximum + 1) / 12));
      const indexes = [
        ...new Set([
          ...Array.from(
            { length: Math.floor(maximum / stride) + 1 },
            (_, index) => index * stride,
          ),
          maximum,
        ]),
      ];
      for (const index of indexes) {
        await timeline.fill(String(index));
        const scene = page.locator(".visual-scene");
        await expect(scene).toHaveAttribute("data-frame-index", String(index));
        const line = Number(await scene.getAttribute("data-source-line"));
        expect(line).toBeGreaterThanOrEqual(1);
        expect(line).toBeLessThanOrEqual(problem.source.split("\n").length);
        largestProjection = Math.max(
          largestProjection,
          await page.locator(problem.projection).count(),
        );
        largestDepth = Math.max(
          largestDepth,
          await page.locator(".call-stack-entry").count(),
        );
        const signature = await scene.evaluate((element) => {
          const text = (selector: string) =>
            [...element.querySelectorAll(selector)]
              .map((item) => item.textContent?.trim() ?? "")
              .join("|");
          return JSON.stringify({
            line: element.getAttribute("data-source-line"),
            stack: text(".call-stack-entry"),
            variables: text(".variable-panel, .local-value"),
            operation: text(
              '.operation:not([data-operation-phase="outgoing"])',
            ),
            markers: [...element.querySelectorAll("[data-variable-path]")]
              .map((item) => [
                item.getAttribute("data-variable-path"),
                item.textContent?.trim() ?? "",
              ]),
          });
        });
        if (signature === previousSignature) {
          duplicateFrames += 1;
        }
        previousSignature = signature;
      }
      if (
        largestProjection < (problem.minimumProjectionCount ?? 1) ||
        largestDepth < (problem.minimumDepth ?? 0)
      ) {
        for (let index = 0; index <= maximum; index += 1) {
          await timeline.fill(String(index));
          largestProjection = Math.max(
            largestProjection,
            await page.locator(problem.projection).count(),
          );
          largestDepth = Math.max(
            largestDepth,
            await page.locator(".call-stack-entry").count(),
          );
          if (
            largestProjection >= (problem.minimumProjectionCount ?? 1) &&
            largestDepth >= (problem.minimumDepth ?? 0)
          ) {
            break;
          }
        }
      }

      expect(largestProjection).toBeGreaterThanOrEqual(
        problem.minimumProjectionCount ?? 1,
      );
      expect(largestDepth).toBeGreaterThanOrEqual(problem.minimumDepth ?? 0);
      if (stride === 1) {
        expect(duplicateFrames / Math.max(1, maximum)).toBeLessThan(0.15);
      }

      await timeline.fill(String(maximum));
      const returnValue = page
        .locator(".variable-panel, .local-value")
        .filter({ hasText: "$return" })
        .first();
      await expect(returnValue).toBeVisible();
      const scalarValues = await returnValue.locator(".scalar-value")
        .allTextContents();
      const normalizedReturn = (
        scalarValues.length > 0
          ? scalarValues.join("")
          : await returnValue.innerText()
      )
        .replace("$return", "")
        .replace(/\s+/g, "")
        .replaceAll('"', "")
        .toLowerCase();
      expect(normalizedReturn).toContain(problem.expectedReturn.toLowerCase());
    });
  }
});

test("recursively inspects mixed payloads inside trees and cyclic graphs", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Recursive composition behavior is viewport-independent.",
  );
  await waitForTrace(page);
  const runSource = async (source: string) => {
    await page.evaluate((nextSource) => {
      const editor = (
        window as typeof window & {
          monaco: {
            editor: {
              getModels(): Array<{ setValue(value: string): void }>;
            };
          };
        }
      ).monaco.editor;
      editor.getModels()[0]?.setValue(nextSource);
    }, source);
    await page.getByLabel("Function entry point").fill("solve");
    await page.getByLabel("Function arguments JSON").fill("[]");
    await page.getByRole("button", { name: "Run code" }).click();
    await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
      timeout: 30_000,
    });
    await expect(page.locator(".error-banner")).toHaveCount(0);
    const timeline = page.getByLabel("Execution timeline");
    await timeline.fill(await timeline.getAttribute("max") ?? "0");
    await expandObjectRelationships(page);
  };
  const inspectNestedGrid = async () => {
    await expandObjectRelationships(page);
    await page.locator(".relation-node").first().click();
    await expect(page.locator(".detail-view")).toBeVisible();
    await page.locator(
      ".detail-content .projection-shell.kind-mapping > header > .projection-shell-inspect",
    ).first().click();
    await page.locator(
      ".detail-content .projection-shell.kind-grid > header > .projection-shell-inspect",
    ).first().click();
    await expect(page.locator(".detail-content .grid-cell")).toHaveCount(4);
    await expect(page.locator(".detail-breadcrumbs")).toBeVisible();
    while (await page.getByRole("button", {
      name: "Back to parent value",
    }).count()) {
      await page.getByRole("button", { name: "Back to parent value" }).click();
    }
    await page.getByRole("button", { name: "Back to execution" }).click();
  };

  await runSource(`class Node:
    def __init__(self, label, payload):
        self.label = label
        self.payload = payload
        self.left = None
        self.right = None

def solve():
    root = Node("root", {"matrix": [[1, 0], [0, 1]], "scores": [8, 13]})
    root.left = Node("left", {"matrix": [[2, 3], [4, 5]], "scores": [3]})
    root.right = Node("right", {"matrix": [[5, 6], [7, 8]], "scores": [5]})
    active = root.left
    return root`);
  await expect(page.locator(".relation-section header strong"))
    .toHaveText("Object relationships");
  await expect(page.locator(".relation-node")).toHaveCount(3);
  await inspectNestedGrid();

  await runSource(`class Vertex:
    def __init__(self, label, payload):
        self.label = label
        self.payload = payload
        self.neighbors = []

def solve():
    first = Vertex("A", {"matrix": [[1, 2], [3, 4]], "tags": {"start"}})
    second = Vertex("B", {"matrix": [[5, 6], [7, 8]], "tags": {"middle"}})
    third = Vertex("C", {"matrix": [[9, 8], [7, 6]], "tags": {"finish"}})
    first.neighbors = [second, third]
    second.neighbors = [first, third]
    third.neighbors = [first]
    current = second
    return first`);
  await expect(page.locator(".relation-section header strong"))
    .toHaveText("Object relationships");
  await expect(page.locator(".relation-node")).toHaveCount(3);
  await inspectNestedGrid();
});

test("keeps exact debugger steps while bounding visualization snapshots", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Executor behavior only needs one browser engine.",
  );
  await waitForTrace(page);
  await page.evaluate(
    (source) => {
      const editor = (
        window as typeof window & {
          monaco: {
            editor: {
              getModels(): Array<{ setValue(value: string): void }>;
            };
          };
        }
      ).monaco.editor;
      editor.getModels()[0]?.setValue(source);
    },
    [
      "def long_sum(limit):",
      "    total = 0",
      "    for value in range(limit):",
      "        total += value",
      "    return total",
    ].join("\n"),
  );
  await page.getByLabel("Function entry point").fill("long_sum");
  await page.getByLabel("Function arguments JSON").fill("[2000]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });

  await expect(page.locator(".error-banner")).toHaveCount(0);
  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  expect(maximum).toBeGreaterThan(500);
  let functionStart = -1;
  for (let index = 0; index <= Math.min(maximum, 20); index += 1) {
    await timeline.fill(String(index));
    if (await page.locator(".visual-heading strong").textContent() === "long_sum") {
      functionStart = index;
      break;
    }
  }
  expect(functionStart).toBeGreaterThanOrEqual(0);
  const executedLines: number[] = [];
  for (let offset = 0; offset < 6; offset += 1) {
    await timeline.fill(String(functionStart + offset));
    executedLines.push(
      Number(
        await page.locator(".visual-scene").getAttribute("data-source-line"),
      ),
    );
  }
  expect(executedLines).toEqual([2, 3, 4, 3, 4, 3]);
  let retainedOperation = false;
  for (let index = Math.floor(maximum / 2); index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (await page.locator(".operation-operation").count()) {
      retainedOperation = true;
      break;
    }
  }
  expect(retainedOperation).toBe(true);
  await timeline.fill(String(maximum));
  await expect(
    page.locator('[data-projection-path="$return"]'),
  ).toHaveText("1999000");
});

test("visualizes primitive operations without changing evaluation semantics", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Executor semantics only need one browser engine.",
  );
  await waitForTrace(page);
  const source = [
    "import builtins",
    "builtins._traceframe_primitive_runs = getattr(builtins, '_traceframe_primitive_runs', 0) + 1",
    "",
      "class Number:",
    "    def __init__(self, value):",
    "        self.value = value",
    "        self.calls = 0",
    "",
    "    def __add__(self, other):",
    "        self.calls += 1",
    "        return self.value + other",
    "",
      "    def __repr__(self):",
      "        raise AssertionError('tracing must not call user repr')",
      "",
      "class TrapMeta(type):",
      "    def __getattribute__(cls, name):",
      "        if name == '__mro__':",
      "            raise AssertionError('tracing must not observe custom metaclasses')",
      "        return super().__getattribute__(name)",
      "",
      "class MetaNumber(metaclass=TrapMeta):",
      "    def __add__(self, other):",
      "        return 7",
      "",
      "class Explosive:",
      "    def __add__(self, other):",
      "        raise RuntimeError('expected overload failure')",
      "",
    "class Truth:",
    "    def __init__(self):",
    "        self.calls = 0",
    "",
    "    def __bool__(self):",
    "        self.calls += 1",
    "        return True",
    "",
    "class Box:",
    "    def __init__(self):",
    "        self._value = 1",
    "        self.reads = 0",
    "",
    "    @property",
    "    def value(self):",
    "        self.reads += 1",
    "        return self._value",
    "",
    "    @value.setter",
    "    def value(self, next_value):",
    "        self._value = next_value",
    "",
    "class IteratorProbe:",
    "    def __iter__(self):",
    "        iterator_events.append('iter')",
    "        return iter([1])",
    "",
    "iterator_events = []",
    "",
    "def compute():",
    "    number = Number(4)",
    "    nums = [9, 4]",
    "    difference = nums[0] - nums[1]",
    "    product = 3 * 2",
      "    nested = number + product",
      "    negative = -nested",
      "    skipped = False and (1 // 0)",
      "    metaclass_result = MetaNumber() + 1",
      "    try:",
      "        Explosive() + 1",
      "    except RuntimeError:",
      "        overload_threw = True",
      "    truth = Truth()",
    "    branch = 1 if truth else 0",
    "    box = Box()",
      "    box.value += 2",
      "    failing = [1]",
      "    try:",
      "        failing[1 // 0] += 1",
      "    except ZeroDivisionError:",
      "        complex_aug_clean = not any(name.startswith('__tf_aug') for name in locals())",
      "    deferred = (item for item in IteratorProbe())",
    "    eager_iterator_count = len(iterator_events)",
    "    list(deferred)",
      "    return [difference, nested, negative, skipped, metaclass_result, overload_threw, number.calls, truth.calls, branch, box.reads, complex_aug_clean, eager_iterator_count, builtins._traceframe_primitive_runs]",
  ].join("\n");
  await page.evaluate((nextSource) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(nextSource);
  }, source);
  await page.getByLabel("Function entry point").fill("compute");
  await page.getByLabel("Function arguments JSON").fill("[]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  const operationText = new Set<string>();
  const operationExpressions = new Set<string>();
  const operationFrames = new Map<string, number>();
  const operationHeights = new Set<string>();
  let focusedCells = 0;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    for (const text of await page.locator(".operation-operation").allTextContents()) {
      operationText.add(text);
    }
    for (const expression of await page.locator(".operation-operation").evaluateAll(
      (elements) => elements.map((element) => element.getAttribute("title")),
    )) {
      if (expression) {
        operationExpressions.add(expression);
      }
    }
    const activeExpression = await page
      .locator('.operation-operation:not([data-operation-phase="outgoing"])')
      .evaluateAll((elements) =>
        elements.at(-1)?.getAttribute("title") ?? null,
      );
    if (activeExpression && !operationFrames.has(activeExpression)) {
      operationFrames.set(activeExpression, index);
    }
    for (const height of await page.locator(".operation-list").evaluateAll(
      (elements) => elements.map((element) => getComputedStyle(element).height),
    )) {
      operationHeights.add(height);
    }
    focusedCells = Math.max(
      focusedCells,
      await page.locator(".sequence-cell.focused").count(),
    );
  }

  expect([...operationText]).toEqual(
    expect.arrayContaining([
      "9 - 4 -> 5",
      "3 * 2 -> 6",
      "-10 -> -10",
    ]),
  );
  expect([...operationText]).not.toContain("Number + 6 -> 10");
  expect([...operationExpressions]).not.toContain("False and (1 // 0)");
  expect([...operationExpressions]).not.toContain("Explosive() + 1");
  expect(focusedCells).toBeGreaterThanOrEqual(2);
  expect([...operationHeights]).toEqual(["25px"]);

  const differenceFrame = operationFrames.get("nums[0] - nums[1]");
  const productFrame = operationFrames.get("3 * 2");
  expect(differenceFrame).toBeDefined();
  expect(productFrame).toBeDefined();
  await timeline.fill(String(differenceFrame));
  await expect(page.locator(".visual-scene")).toHaveAttribute(
    "data-source-line",
    String(
      source
        .split("\n")
        .findIndex((line) => line.includes("difference = nums[0]")) + 1,
    ),
  );
  await expect(page.locator(".visual-scene")).toContainText("difference");
  await expect(page.locator(".operation-motion-operand")).toHaveText([
    "9",
    "4",
  ]);
  await expect(page.locator(".operation-motion-operator")).toHaveText("-");
  await expect(page.locator(".operation-motion-result")).toHaveText("5");
  expect(
    await page.locator(".visual-scene").evaluate((scene) => ({
      target: scene
        .querySelector<HTMLElement>(".operation-motion-layer")
        ?.dataset.operationTarget,
      targetOpacity: scene
        .querySelector<HTMLElement>('[data-projection-path="difference"]')
        ?.style.opacity,
    })),
  ).toEqual({
    target: "difference",
    targetOpacity: "0",
  });
  await expect(page.locator(".operation-motion-layer")).toHaveCount(0, {
    timeout: 2_000,
  });
  await expect(
    page.locator('[data-projection-path="difference"]'),
  ).not.toHaveCSS("opacity", "0");
  await page.waitForTimeout(220);
  await page.evaluate(() => {
    const row = document.querySelector(".operation-list");
    document.documentElement.dataset.operationMaxLayers =
      String(row?.children.length ?? 0);
    const observer = new MutationObserver(() => {
      const count = row?.children.length ?? 0;
      const previous = Number(
        document.documentElement.dataset.operationMaxLayers ?? "0",
      );
      document.documentElement.dataset.operationMaxLayers =
        String(Math.max(previous, count));
    });
    if (row) {
      observer.observe(row, { childList: true });
      window.setTimeout(() => observer.disconnect(), 500);
    }
  });
  await timeline.fill(String(productFrame));
  await expect.poll(() =>
    page.locator("html").getAttribute("data-operation-max-layers"),
  ).toBe("2");
  const transitionHeight = await page.locator(".change-strip").evaluate(
    (element) => getComputedStyle(element).height,
  );
  await page.waitForTimeout(220);
  await expect(page.locator(".operation-operation")).toHaveCount(1);
  expect(
    await page.locator(".change-strip").evaluate(
      (element) => getComputedStyle(element).height,
    ),
  ).toBe(transitionHeight);

  await timeline.fill(String(maximum));
  await expect(
    page.locator('.sequence-cell[data-projection-path^="$return["]'),
  ).toHaveCount(13);
  expect(
    await page
      .locator('.sequence-cell[data-projection-path^="$return["] > .scalar-value')
      .allTextContents(),
  ).toEqual(["5", "10", "-10", "false", "7", "true", "1", "1", "1", "1", "true", "1", "1"]);
});

test("keeps non-finite values out of primitive operation payloads", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Executor payload behavior only needs one browser engine.",
  );
  await waitForTrace(page);
  await page.evaluate((source) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(source);
  }, [
    "def calculate():",
    "    infinite = float('inf')",
    "    return infinite + 1",
  ].join("\n"));
  await page.getByLabel("Function entry point").fill("calculate");
  await page.getByLabel("Function arguments JSON").fill("[]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  const operationText = new Set<string>();
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    for (const text of await page.locator(".operation-operation").allTextContents()) {
      operationText.add(text);
    }
  }

  expect([...operationText]).not.toContain("inf + 1 -> inf");
});

test("steps into loop bodies reached through generator expressions", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Debugger event behavior only needs one browser engine.",
  );
  await waitForTrace(page);
  const source = [
    "class Solution:",
    "    waves = [10, 20, 21]",
    "",
    "    def totalWaviness(self, A: int, B: int) -> int:",
    "        return self.waveCount(B) - self.waveCount(A - 1)",
    "",
    "    def waveCount(self, num):",
    "        if num < 100: return 0",
    "        return sum(self.countWays(num, p) for p in self.waves)",
    "",
    "    def countWays(self, num, pattern):",
    "        s = str(num)",
    "        n = len(s)",
    "        t = pattern < 99",
    "        count = 0",
    "        for i in range(n - 2):",
    "            pre = int(s[:i] or 0)",
    "            cur = int(s[i:i+3])",
    "            suf = int(s[i+3:] or 0)",
    "            mult = 10 ** (n - i - 3)",
    "            ways = 0",
    "            count += ways * mult",
    "        return count",
  ].join("\n");
  await page.evaluate((nextSource) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(nextSource);
  }, source);
  await page.getByLabel("Function entry point").fill("totalWaviness");
  await page.getByLabel("Function arguments JSON").fill("[1, 1000]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  const countWaysLines: number[] = [];
  let largestCountWaysVisualization = 0;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (
      await page.locator(".visual-heading strong").textContent() === "countWays"
    ) {
      countWaysLines.push(
        Number(
          await page.locator(".visual-scene").getAttribute("data-source-line"),
        ),
      );
      largestCountWaysVisualization = Math.max(
        largestCountWaysVisualization,
        await page.locator(".scalar-value").count(),
      );
    }
  }
  expect(countWaysLines).toEqual(
    expect.arrayContaining([16, 17, 18, 19, 20, 21]),
  );
  expect(largestCountWaysVisualization).toBeGreaterThan(0);
});

test("exposes class data as inspectable debugger containers", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Debugger member behavior only needs one browser engine.",
  );
  await waitForTrace(page);
  await page.evaluate((source) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(source);
  }, [
    "class Solution:",
    "    waves = [10, 20, 21]",
    "",
    "    def solve(this):",
    "        return len(this.waves)",
  ].join("\n"));
  await page.getByLabel("Function entry point").fill("solve");
  await page.getByLabel("Function arguments JSON").fill("[]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  let foundWaves = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (
      await page
        .locator(".visual-scene")
        .getByText("this.waves", { exact: true })
        .count()
    ) {
      foundWaves = true;
      break;
    }
  }
  expect(foundWaves).toBe(true);
  await expect(page.getByText("Object tree", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sequence-cell")).toHaveCount(3);
});

test("traces large helper-call workloads within the execution limit", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Debugger performance only needs one browser engine.",
  );
  await waitForTrace(page);
  const waves = Array.from({ length: 600 }, (_, index) => index + 10);
  const source = [
    "class Solution:",
    `    waves = ${JSON.stringify(waves)}`,
    "",
    "    def totalWaviness(self, A: int, B: int) -> int:",
    "        return self.waveCount(B) - self.waveCount(A - 1)",
    "",
    "    def waveCount(self, num):",
    "        if num < 100: return 0",
    "        return sum(self.countWays(num, p) for p in self.waves)",
    "",
    "    def countWays(self, num, pattern):",
    "        s = str(num)",
    "        n = len(s)",
    "        t = pattern < 99",
    "        count = 0",
    "        for i in range(n - 2):",
    "            pre = int(s[:i] or 0)",
    "            cur = int(s[i:i+3])",
    "            suf = int(s[i+3:] or 0)",
    "            mult = 10 ** (n - i - 3)",
    "            ways = 0",
    "            if cur > pattern:",
    "                ways = pre - t + 1",
    "            elif cur == pattern:",
    "                ways = max(0, pre - t)",
    "                count += suf + 1",
    "            else:",
    "                ways = max(0, pre - t)",
    "            count += ways * mult",
    "        return count",
  ].join("\n");
  await page.evaluate((nextSource) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(nextSource);
  }, source);
  await page.getByLabel("Function entry point").fill("totalWaviness");
  await page.getByLabel("Function arguments JSON").fill("[120, 130]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  await timeline.fill(await timeline.getAttribute("max") ?? "0");
  await expect(
    page.locator('[data-projection-path="$return"]'),
  ).toBeVisible();
});

test("stops memory-heavy code and preserves its partial trace", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The runtime limit is independent of viewport size.",
  );
  await waitForTrace(page);

  await page.locator(".monaco-editor").click({
    position: { x: 240, y: 120 },
  });
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(
    "blocks = []\nwhile True:\n    blocks.append([0] * 1_000_000)\n",
  );
  await page.getByRole("button", { name: "Script", exact: true }).click();
  await page.getByRole("button", { name: "Run code" }).click();

  await expect(page.locator(".error-banner")).toContainText(
    "Execution exceeded the 64 MB memory limit",
    { timeout: 30_000 },
  );
  await expect(page.getByLabel("Execution timeline")).toBeEnabled();
  expect(
    Number(await page.getByLabel("Execution timeline").getAttribute("max")),
  ).toBeGreaterThan(0);
  await expect(page.locator(".visual-scene")).toBeVisible();
});

test("runs pasted LeetCode Solution methods by bare method name", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Entrypoint resolution is independent of viewport size.",
  );
  await waitForTrace(page);

  await page.evaluate(
    (source) => {
      const editor = (
        window as typeof window & {
          monaco: {
            editor: {
              getModels(): Array<{ setValue(value: string): void }>;
            };
          };
        }
      ).monaco.editor;
      editor.getModels()[0]?.setValue(source);
    },
    [
      "class Solution:",
      "    def assignEdgeWeights(self, edges: List[List[int]]) -> int:",
      "        graph = [[] for _ in range(len(edges) + 2)]",
      "        for u, v in edges:",
      "            graph[u].append(v)",
      "            graph[v].append(u)",
      "        return len(graph[1])",
      "",
    ].join("\n"),
  );
  await page.getByLabel("Function entry point").fill("assignEdgeWeights");
  await page.getByLabel("Function arguments JSON").fill("[[[1,2]]]");
  await page.getByRole("button", { name: "Run code" }).click();

  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Execution visualization" }),
  ).toContainText("assignEdgeWeights");
  await expect(page.locator(".visual-scene")).toContainText("edges");
  await expect(page.getByText("Object tree", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inspect self" })).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  await timeline.fill(await timeline.getAttribute("max") ?? "0");
  const graphViewButton = page.getByRole("button", {
    name: "View graph as a graph",
  });
  await expect(graphViewButton).toBeVisible();
  await graphViewButton.click();
  await expect(page.locator(".graph-node")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "View graph structurally" }),
  ).toBeVisible();
});

test("starts function playback at the first executable statement", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Function playback filtering is independent of viewport size.",
  );
  await waitForTrace(page);
  await page.evaluate((source) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(source);
  }, [
    "class Solution:",
    "    def calculate(self, nums: List[int]) -> int:",
    "        left = nums[0] + nums[1]",
    "        return left",
  ].join("\n"));
  await page.getByLabel("Function entry point").fill("calculate");
  await page.getByLabel("Function arguments JSON").fill("[[3,8]]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  const executedLines: number[] = [];
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    executedLines.push(
      Number(await page.locator(".visual-scene").getAttribute("data-source-line")),
    );
  }
  expect(executedLines[0]).toBe(3);
  expect(executedLines).not.toContain(1);
  expect(executedLines).not.toContain(2);
});

test("provides the standard algorithm prelude used by pasted solutions", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The Python execution profile is independent of viewport size.",
  );
  await waitForTrace(page);
  await page.evaluate((source) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(source);
  }, [
    "class Solution:",
    "    def leftRightDifference(this, nums: List[int]) -> List[int]:",
    "        return (L:=list(accumulate(nums, initial=0))) and [abs(L[-1]-x-2*l) for l, x in zip(L, nums)]",
  ].join("\n"));
  await page.getByLabel("Function entry point").fill("leftRightDifference");
  await page.getByLabel("Function arguments JSON").fill("[[10,4,8,3]]");
  await page.getByRole("button", { name: "Run code" }).click();

  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  const timeline = page.getByLabel("Execution timeline");
  await timeline.fill(await timeline.getAttribute("max") ?? "0");
  const returnPanel = page.locator(".variable-panel").filter({
    has: page.getByRole("button", { name: "Inspect $return" }),
  });
  await expect(returnPanel.locator(".sequence-cell")).toHaveCount(4);
  await expect(
    returnPanel.locator(".sequence-cell .scalar-value"),
  ).toHaveText(["15", "1", "11", "22"]);
});

test("projects memoized recursion as a generic DP mapping", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Python memo instrumentation is independent of viewport size.",
  );
  await waitForTrace(page);
  const source = [
    "class Solution:",
    '    s = ["Bob", "Tie", "Alice"]',
    "    def stoneGameIII(self, A: List[int]) -> str:",
    "        n = len(A)",
    "",
    "        @cache",
    "        def maxDiff(i: int) -> int:",
    "            if i == n: return 0",
    "            a = b = c = -5e7",
    "",
    "            if i < n:",
    "                a = A[i] - maxDiff(i + 1)",
    "            if i + 1 < n:",
    "                b = A[i] + A[i + 1] - maxDiff(i + 2)",
    "            if i + 2 < n:",
    "                c = A[i] + A[i + 1] + A[i + 2] - maxDiff(i + 3)",
    "",
    "            return max(a, b, c)",
    "",
    "        d = maxDiff(0)",
    "        return self.s[(d > 0) - (d < 0) + 1]",
  ].join("\n");
  await page.evaluate((nextSource) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(nextSource);
  }, source);
  await page.getByLabel("Function entry point").fill("stoneGameIII");
  await page.getByLabel("Function arguments JSON").fill("[[1,2,3,7]]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  const executionHighlight = page.getByTestId("execution-line-highlight");
  let largestMemo = 0;
  let largestDepth = 0;
  let sawHit = false;
  let sawMiss = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const sourceLine = await page.locator(".visual-scene")
      .getAttribute("data-source-line");
    await expect(executionHighlight).toBeVisible();
    await expect(executionHighlight).toHaveAttribute(
      "data-source-line",
      sourceLine!,
    );
    const memoPanel = page.locator(".variable-panel").filter({
      has: page.getByRole("button", { name: "Inspect maxDiff.memo" }),
    });
    largestMemo = Math.max(
      largestMemo,
      await memoPanel.locator(".mapping-row").count(),
    );
    largestDepth = Math.max(
      largestDepth,
      await page.locator(".call-stack-entry").count(),
    );
    const operation = await page.locator(".operation-memo").allTextContents();
    sawHit ||= operation.some((text) => text.includes("reuse"));
    sawMiss ||= operation.some((text) => text.includes("memoize"));
  }

  expect(largestMemo).toBe(5);
  expect(largestDepth).toBeGreaterThanOrEqual(5);
  expect(sawHit).toBe(true);
  expect(sawMiss).toBe(true);
  await timeline.fill(String(maximum));
  await expect(
    page.locator(".local-value").filter({ hasText: "$return" }),
  ).toContainText("Bob");

  await page.evaluate((nextSource) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(nextSource);
  }, [
    "calls = 0",
    "def cache(fn):",
    "    def wrapped(value):",
    "        global calls",
    "        calls += 1",
    "        return fn(value)",
    "    return wrapped",
    "@cache",
    "def calculate(value):",
    "    return value * 2",
    "def run():",
    "    return [calculate(3), calls]",
  ].join("\n"));
  await page.getByLabel("Function entry point").fill("run");
  await page.getByLabel("Function arguments JSON").fill("[]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);
  await timeline.fill(await timeline.getAttribute("max") ?? "0");
  await expect(
    page.locator('.sequence-cell[data-projection-path^="$return["] .scalar-value'),
  ).toHaveText(["6", "1"]);
  await expect(
    page.getByRole("button", { name: /Inspect .*\.memo/ }),
  ).toHaveCount(0);
});

test("attaches persistent loop and recursion bindings to structures", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Semantic binding behavior is independent of viewport size.",
  );
  await waitForTrace(page);
  const timeline = page.getByLabel("Execution timeline");

  const runExample = async (id: string) => {
    await page.getByLabel("Example program").selectOption(id);
    await page.getByRole("button", { name: "Run code" }).click();
    await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
      timeout: 30_000,
    });
    await expect(page.locator(".error-banner")).toHaveCount(0);
    return Number(await timeline.getAttribute("max"));
  };

  let maximum = await runExample("bubble-sort");
  let foundBubbleBindings = false;
  let activeBubbleFrames = 0;
  for (let frameIndex = 0; frameIndex <= maximum; frameIndex += 1) {
    await timeline.fill(String(frameIndex));
    const sourceLine = Number(
      await page.locator(".visual-scene").getAttribute("data-source-line"),
    );
    const markers = await page
      .locator('.variable-marker[data-variable-path^="nums["]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          label: element.textContent?.trim() ?? "",
          path: element.getAttribute("data-variable-path") ?? "",
        })),
      );
    const index = markers.find((marker) => marker.label === "index");
    const next = markers.find((marker) => marker.label === "index + 1");
    const hasPair =
      index &&
      next &&
      Number(/\[(\d+)\]$/.exec(next.path)?.[1]) ===
        Number(/\[(\d+)\]$/.exec(index.path)?.[1]) + 1;
    if (hasPair) {
      foundBubbleBindings = true;
      activeBubbleFrames += 1;
      continue;
    }
    if (foundBubbleBindings && sourceLine >= 4 && sourceLine <= 7) {
      throw new Error(
        `Bubble-sort bindings disappeared on active loop frame ${frameIndex}`,
      );
    }
    if (foundBubbleBindings) {
      break;
    }
  }
  expect(foundBubbleBindings).toBe(true);
  expect(activeBubbleFrames).toBeGreaterThan(3);

  maximum = await runExample("two-sum");
  const twoSumPaths = new Set<string>();
  let previousMarker:
    | { frame: number; path: string }
    | undefined;
  let markerTransition:
    | { from: number; to: number }
    | undefined;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const paths = await page
      .locator('.variable-marker[data-variable-path^="nums["]')
      .evaluateAll((markers) =>
        markers.flatMap((marker) =>
          marker.getAttribute("data-variable-path") ?? [],
        ),
      );
    for (const path of paths) {
      twoSumPaths.add(path);
    }
    const path = paths[0];
    if (
      path &&
      previousMarker &&
      previousMarker.frame === index - 1 &&
      previousMarker.path !== path
    ) {
      markerTransition = { from: previousMarker.frame, to: index };
    }
    previousMarker = path ? { frame: index, path } : undefined;
  }
  expect(twoSumPaths).toEqual(new Set(["nums[0]", "nums[1]"]));
  expect(markerTransition).toBeDefined();
  await timeline.fill(String(markerTransition!.from));
  await page.waitForTimeout(400);
  const movingMarker = page.locator(".variable-marker").filter({
    hasText: "index",
  });
  await movingMarker.evaluate((element) => {
    element.setAttribute("data-transition-started", "false");
    element.addEventListener(
      "transitionrun",
      () => element.setAttribute("data-transition-started", "true"),
      { once: true },
    );
  });
  await timeline.fill(String(markerTransition!.to));
  await expect(movingMarker).toHaveAttribute("data-transition-started", "true");

  maximum = await runExample("two-pointer-scan");
  let foundTwoPointers = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const labels = await page
      .locator('.variable-marker[data-variable-path^="nums["]')
      .allTextContents();
    if (labels.includes("left") && labels.includes("right")) {
      foundTwoPointers = true;
      break;
    }
  }
  expect(foundTwoPointers).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("iteration-bindings.png"),
  });

  maximum = await runExample("grid-walk");
  let foundNestedBindings = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const paths = await page
      .locator('.variable-marker[data-variable-path^="grid["]')
      .evaluateAll((markers) =>
        markers.flatMap((marker) =>
          marker.getAttribute("data-variable-path") ?? [],
        ),
      );
    if (
      paths.some((path) => /^grid\[\d+\]$/.test(path)) &&
      paths.some((path) => /^grid\[\d+\]\[\d+\]$/.test(path))
    ) {
      foundNestedBindings = true;
      break;
    }
  }
  expect(foundNestedBindings).toBe(true);

  maximum = await runExample("bfs");
  let foundGraphBinding = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const marker = page
      .locator('.graph-variable-marker[data-variable-path^="graph["]')
      .filter({ hasText: "neighbor" });
    if (await marker.count()) {
      foundGraphBinding = true;
      break;
    }
  }
  expect(foundGraphBinding).toBe(true);

  maximum = await runExample("binary-tree");
  let foundRecursiveBinding = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (
      await page.locator(".call-stack-entry").count() >= 3 &&
      (await page.locator(".entity-bindings").allTextContents())
        .some((text) => text.includes("node"))
    ) {
      foundRecursiveBinding = true;
      break;
    }
  }
  expect(foundRecursiveBinding).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("recursive-binding.png"),
  });
});

test("renders, scrubs rapidly, and has no serious accessibility violations", async ({
  page,
}, testInfo) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await waitForTrace(page);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  for (const value of [maximum, 0, Math.floor(maximum / 2), maximum]) {
    await timeline.fill(String(value));
  }

  await expect(page.locator(".scene-meta")).toHaveCount(0);
  await expect(page.locator(".frame-meta")).toHaveCount(0);
  await expect(page.locator(".call-stack-strip")).toHaveCount(0);
  await expect(page.locator(".variable-panel")).toHaveCount(1);
  await expect(page.locator(".variable-alias")).toContainText("$return");
  await expect(page.locator(".change-strip")).toHaveCount(0);
  await page.waitForTimeout(260);
  const thumb = page.locator(".timeline-thumb");
  await thumb.evaluate((element) => {
    element.setAttribute("data-transition-started", "false");
    element.addEventListener(
      "transitionrun",
      () => element.setAttribute("data-transition-started", "true"),
      { once: true },
    );
  });
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(thumb).toHaveAttribute("data-transition-started", "true");
  await page.waitForTimeout(260);
  await expect(page.locator(".visual-scene")).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath("playground.png"),
  });
  const results = await new AxeBuilder({ page })
    .include(".visual-pane")
    .analyze();
  const serious = results.violations.filter(({ impact }) =>
    impact === "serious" || impact === "critical",
  );
  expect(serious).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("semantic zoom animates from the selected entity in both directions", async ({
  page,
}) => {
  await waitForTrace(page);
  await page.getByLabel("Example program").selectOption("binary-tree");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({ timeout: 30_000 });
  await expandObjectRelationships(page);
  await expect(page.locator(".relation-node").first()).toBeVisible({
    timeout: 30_000,
  });

  await page.locator(".relation-node").first().click();
  await expect(page.locator(".detail-view")).toBeVisible();
  await expect(page.locator(".scene-motion-ghost")).toHaveCount(1);
  await expect(page.locator(".scene-motion-ghost")).toHaveCount(0);

  await page.getByRole("button", { name: "Back to execution" }).click();
  await expect(page.locator(".visual-scene")).toBeVisible();
  await expect(page.locator(".scene-motion-ghost")).toHaveCount(1);
  await expect(page.locator(".scene-motion-ghost")).toHaveCount(0);
});

test("renders a cyclic linked list as a directed circle", async ({
  page,
}, testInfo) => {
  await waitForTrace(page);
  await page.getByLabel("Example program").selectOption("cyclic-list");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expandObjectRelationships(page);
  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (await page.locator(".relation-node").count() === 2) {
      break;
    }
  }

  await expect(page.locator(".relation-section header strong"))
    .toHaveText("Object relationships");
  await expect(page.locator(".relation-edges > path")).toHaveCount(2);
  const paths = await page.locator(".relation-edges > path").evaluateAll(
    (elements) => elements.map((element) => ({
      d: element.getAttribute("d"),
      marker: element.getAttribute("marker-end"),
    })),
  );
  expect(paths.every(({ d }) => d?.includes(" Q "))).toBe(true);
  expect(paths.every(({ marker }) => marker?.startsWith("url("))).toBe(true);
  const centers = await page.locator(".relation-node").evaluateAll(
    (nodes) => nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
    }),
  );
  expect(Math.abs(centers[0].y - centers[1].y)).toBeLessThan(2);
  expect(Math.abs(centers[0].x - centers[1].x)).toBeGreaterThan(100);
  const labelTops = await page.locator(".relation-label").evaluateAll(
    (labels) => labels.map((label) => label.getBoundingClientRect().top),
  );
  expect(Math.abs(labelTops[0] - labelTops[1])).toBeGreaterThan(30);
  await page.screenshot({
    path: testInfo.outputPath("cyclic-linked-list.png"),
  });
});

test("keeps a complete identity tree visible through recursive inversion", async ({
  page,
}) => {
  await waitForTrace(page);
  await page.getByLabel("Example program").selectOption("invert-tree");
  await page.getByRole("button", { name: "Run code" }).click();
  const timeline = page.getByLabel("Execution timeline");
  await expect(timeline).toBeEnabled({ timeout: 30_000 });
  await expandObjectRelationships(page);
  const maximum = Number(await timeline.getAttribute("max"));
  let foundDeepFrame = false;

  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const stackDepth = await page.locator(".call-stack-entry").count();
    if (stackDepth < 3) {
      continue;
    }
    await expect(page.locator(".relation-node")).toHaveCount(7);
    expect(await page.locator(".relation-node").allTextContents())
      .not.toContain("Sol...");
    await expect(page.locator(
      ".visual-scene .projection-shell.kind-object.collapsed",
    )).toHaveCount(0);
    foundDeepFrame = true;
    break;
  }

  expect(foundDeepFrame).toBe(true);

  let swapFrame = -1;
  for (let index = 1; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (
      await page.locator(".operation-swap").count() > 0 &&
      await page.locator(".visual-scene").getAttribute("data-call-depth") === "1"
    ) {
      swapFrame = index;
      break;
    }
  }
  expect(swapFrame).toBeGreaterThan(0);

  const nodeCenter = async (label: string) => {
    const box = await page
      .getByRole("button", { name: label, exact: true })
      .boundingBox();
    expect(box).not.toBeNull();
    return box!.x + box!.width / 2;
  };
  await timeline.fill(String(swapFrame - 1));
  await page.waitForTimeout(550);
  const twoBefore = await nodeCenter("2");
  const threeBefore = await nodeCenter("3");
  expect(twoBefore).toBeLessThan(threeBefore);

  await timeline.fill(String(swapFrame));
  await page.waitForTimeout(550);
  const twoAfter = await nodeCenter("2");
  const threeAfter = await nodeCenter("3");
  expect(threeAfter).toBeLessThan(threeBefore);
  expect(Math.abs(twoAfter - threeBefore)).toBeLessThan(1);
  expect(Math.abs(threeAfter - twoBefore)).toBeLessThan(1);
});

test("tweens the execution-line indicator during interrupted scrubbing", async ({
  page,
}) => {
  await waitForTrace(page);
  const timeline = page.getByLabel("Execution timeline");
  const highlight = page.getByTestId("execution-line-highlight");
  const maximum = Number(await timeline.getAttribute("max"));
  const initialIndex = Number(await timeline.inputValue());
  const initialLine = await page
    .locator(".visual-scene")
    .getAttribute("data-source-line");
  await expect(highlight).toBeVisible();

  let targetIndex = -1;
  for (let index = 0; index <= maximum; index += 1) {
    if (index === initialIndex) {
      continue;
    }
    await timeline.fill(String(index));
    await expect(page.locator(".visual-scene"))
      .toHaveAttribute("data-frame-index", String(index));
    if (
      await page.locator(".visual-scene").getAttribute("data-source-line") !==
      initialLine
    ) {
      targetIndex = index;
      break;
    }
  }
  expect(targetIndex).toBeGreaterThanOrEqual(0);
  await timeline.fill(String(initialIndex));
  await page.waitForTimeout(300);
  await timeline.fill(String(targetIndex));
  await expect.poll(() =>
    highlight.evaluate((element) => element.getAnimations().length),
  ).toBeGreaterThan(0);

  await timeline.fill("0");
  await timeline.fill(String(Math.floor(maximum / 2)));
  await timeline.fill(String(maximum));
  await expect.poll(() =>
    highlight.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  const transform = await highlight.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(transform).toMatch(/^matrix/);
  expect(transform).not.toContain("NaN");
});

test("tweens semantic focus colors instead of flashing final colors", async ({
  page,
}) => {
  await waitForTrace(page);
  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  let previousPaths: string[] = [];
  let transition:
    | { from: number; path: string; to: number }
    | undefined;

  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    await expect(page.locator(".visual-scene"))
      .toHaveAttribute("data-frame-index", String(index));
    const currentPaths = await page
      .locator(".sequence-cell.focused")
      .evaluateAll((elements) =>
        elements.flatMap((element) =>
          element.getAttribute("data-projection-path") ?? [],
        ),
      );
    const newlyFocused = currentPaths.find(
      (path) => !previousPaths.includes(path),
    );
    if (index > 0 && newlyFocused) {
      transition = { from: index - 1, path: newlyFocused, to: index };
      break;
    }
    previousPaths = currentPaths;
  }

  expect(transition).toBeDefined();
  await timeline.fill(String(transition!.from));
  await page.waitForTimeout(260);
  const cell = page.locator(
    `.sequence-cell[data-projection-path="${transition!.path}"]`,
  );
  const before = await cell.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await cell.evaluate((element) => {
    element.setAttribute("data-color-transition-started", "false");
    element.addEventListener(
      "transitionrun",
      () => element.setAttribute("data-color-transition-started", "true"),
      { once: true },
    );
  });

  await timeline.fill(String(transition!.to));
  await expect(cell).toHaveClass(/focused/);
  await expect(cell).toHaveAttribute(
    "data-color-transition-started",
    "true",
  );
  await page.waitForTimeout(260);
  const after = await cell.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(after).not.toBe(before);
});

test("tweens newly introduced visualization elements", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Mount animation behavior is independent of viewport size.",
  );
  await waitForTrace(page);
  await page.getByLabel("Example program").selectOption("factorial");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  await timeline.fill("0");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.documentElement.dataset.enterAnimation = "";
    document.addEventListener("animationstart", (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.classList.contains("call-stack-entry-wrap")
      ) {
        document.documentElement.dataset.enterAnimation =
          event.animationName;
      }
    });
  });

  for (let index = 1; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (await page.locator(".call-stack-entry").count() > 1) {
      break;
    }
  }

  await expect(page.locator(".call-stack-entry")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute(
    "data-enter-animation",
    "tf-element-enter",
  );
  await expect.poll(() =>
    page.locator(".call-stack-entry-wrap").last().evaluate(
      (element) => element.getAnimations().length,
    ),
  ).toBeGreaterThan(0);
});

test("visualizes scalar recursion as a call chain", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The recursion semantics are viewport independent.",
  );
  await waitForTrace(page);
  await page.getByLabel("Example program").selectOption("factorial");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  let deepestFrame = -1;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (await page.locator(".recursion-call").count() === 5) {
      deepestFrame = index;
      break;
    }
  }

  expect(deepestFrame).toBeGreaterThanOrEqual(0);
  await timeline.fill(String(deepestFrame));
  await expect(page.locator(".recursion-call")).toHaveCount(5);
  await expect(page.locator(".recursion-arrow")).toHaveCount(4);
  await expect(page.locator(".recursion-call strong")).toHaveText([
    "5",
    "4",
    "3",
    "2",
    "1",
  ]);
  await expect(page.locator(".recursion-call.active")).toContainText("1");

  let returnFrame = -1;
  for (let index = deepestFrame; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (await page.locator(".recursion-return").count() > 0) {
      returnFrame = index;
      break;
    }
  }
  expect(returnFrame).toBeGreaterThanOrEqual(deepestFrame);
  await expect(page.locator(".recursion-return")).toHaveText("return 1");
});

test("visualizes mutual recursion from generic activation facts", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The activation model is viewport independent.",
  );
  await waitForTrace(page);
  await page.evaluate((source) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(source);
  }, `def is_even(n):
    if n == 0:
        return True
    return is_odd(n - 1)

def is_odd(n):
    if n == 0:
        return False
    return is_even(n - 1)`);
  await page.getByLabel("Function entry point").fill("is_even");
  await page.getByLabel("Function arguments JSON").fill("[4]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  let deepestFrame = -1;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (await page.locator(".recursion-call").count() === 5) {
      deepestFrame = index;
      break;
    }
  }

  expect(deepestFrame).toBeGreaterThanOrEqual(0);
  await expect(page.locator(".recursion-call small")).toHaveText([
    "is_even",
    "is_odd",
    "is_even",
    "is_odd",
    "is_even",
  ]);
  await expect(page.locator(".recursion-call strong")).toHaveText([
    "4",
    "3",
    "2",
    "1",
    "0",
  ]);
  await expect(
    page.getByRole("region", { name: "Recursive evaluation" }),
  ).toBeVisible();
});

test("tracks generator suspension, resume, and ordinary calls", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Generator event semantics are viewport independent.",
  );
  await waitForTrace(page);
  await page.evaluate((source) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(source);
  }, `def numbers(limit):
    for index in range(limit):
        yield index

def consume(limit):
    stream = numbers(limit)
    first = next(stream)
    second = next(stream)
    return first + second`);
  await page.getByLabel("Function entry point").fill("consume");
  await page.getByLabel("Function arguments JSON").fill("[3]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  let suspendedFrame = -1;
  let observedNextCall = false;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    if (await page.locator('.operation[title*="next(stream)"]').count()) {
      observedNextCall = true;
    }
    if (await page.locator(".suspended-call").count()) {
      suspendedFrame = index;
      break;
    }
  }

  expect(suspendedFrame).toBeGreaterThanOrEqual(0);
  await expect(page.locator(".suspended-call")).toContainText("numbers");
  await expect(page.locator(".suspended-call")).toContainText("yield 0");
  expect(observedNextCall).toBe(true);
});

test("attributes opaque container mutations to ordinary calls", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Opaque call causality is viewport independent.",
  );
  await waitForTrace(page);
  await page.evaluate((source) => {
    const editor = (
      window as typeof window & {
        monaco: {
          editor: {
            getModels(): Array<{ setValue(value: string): void }>;
          };
        };
      }
    ).monaco.editor;
    editor.getModels()[0]?.setValue(source);
  }, `def mutate(values):
    values.append(4)
    return len(values)`);
  await page.getByLabel("Function entry point").fill("mutate");
  await page.getByLabel("Function arguments JSON").fill("[[1,2,3]]");
  await page.getByRole("button", { name: "Run code" }).click();
  await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
    timeout: 30_000,
  });
  await expect(page.locator(".error-banner")).toHaveCount(0);

  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  let mutationFrame = -1;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const edges = Number(
      await page.locator(".visual-scene").getAttribute(
        "data-dataflow-edge-count",
      ) ?? 0,
    );
    if (
      edges > 0 &&
      await page.locator('.operation[title*="values.append(4)"]').count()
    ) {
      mutationFrame = index;
      break;
    }
  }

  expect(mutationFrame).toBeGreaterThanOrEqual(0);
  await expect(page.locator(".sequence-cell")).toHaveCount(4);
  await expect(page.locator(".visual-scene")).toHaveAttribute(
    "data-dataflow-edge-count",
    /^[1-9]\d*$/,
  );
});

test("respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitForTrace(page);
  const timeline = page.getByLabel("Execution timeline");
  const maximum = Number(await timeline.getAttribute("max"));
  const highlight = page.getByTestId("execution-line-highlight");
  await timeline.fill(String(maximum));
  await expect(highlight).toBeVisible();
  expect(
    await highlight.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  expect(
    await page.locator(".timeline-thumb").evaluate(
      (element) => element.getAnimations().length,
    ),
  ).toBe(0);

  let firstOperationFrame = -1;
  let secondOperationFrame = -1;
  let previousExpression: string | null = null;
  for (let index = 0; index <= maximum; index += 1) {
    await timeline.fill(String(index));
    const expression = await page
      .locator('.operation:not([data-operation-phase="outgoing"])')
      .evaluateAll((elements) =>
        elements.at(-1)?.getAttribute("title") ?? null,
      );
    if (!expression || expression === previousExpression) {
      continue;
    }
    if (firstOperationFrame < 0) {
      firstOperationFrame = index;
      previousExpression = expression;
      continue;
    }
    secondOperationFrame = index;
    break;
  }
  expect(firstOperationFrame).toBeGreaterThanOrEqual(0);
  expect(secondOperationFrame).toBeGreaterThan(firstOperationFrame);
  await timeline.fill(String(firstOperationFrame));
  await page.waitForTimeout(220);
  await timeline.fill(String(secondOperationFrame));
  await expect(page.locator(".operation-equation-incoming")).toHaveCount(1);
  expect(
    await page.locator(".operation").evaluateAll((elements) =>
      elements.reduce(
        (count, element) => count + element.getAnimations().length,
        0,
      ),
    ),
  ).toBe(0);

  const inspect = page.locator(".inspect-button").first();
  await inspect.click();
  await expect(page.locator(".detail-view")).toBeVisible();
  await expect(page.locator(".scene-motion-ghost")).toHaveCount(0);
});
