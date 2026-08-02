import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

interface AdversarialCase {
  name: string;
  source: string;
  entrypoint: string;
  arguments: unknown[];
  expectedReturn: string;
  expectedProjection?: string;
}

const cases: AdversarialCase[] = [
  {
    name: "closure callback",
    source: `def solve(nums):
    pivot = 4
    def distance(value):
        return abs(value - pivot)
    return sorted(nums, key=distance)`,
    entrypoint: "solve",
    arguments: [[9, 1, 5, 3]],
    expectedReturn: "5319",
    expectedProjection: ".sequence-cell",
  },
  {
    name: "caught exceptions",
    source: `def solve(values):
    total = 0
    rejected = []
    for value in values:
        try:
            total += int(value)
        except ValueError:
            rejected.append(value)
    return [total, len(rejected)]`,
    entrypoint: "solve",
    arguments: [["4", "bad", "7"]],
    expectedReturn: "111",
    expectedProjection: ".sequence-cell",
  },
  {
    name: "yield from generator",
    source: `def flatten(groups):
    for group in groups:
        yield from group

def solve(groups):
    return list(flatten(groups))`,
    entrypoint: "solve",
    arguments: [[[1, 2], [], [3, 4]]],
    expectedReturn: "1234",
    expectedProjection: ".sequence-cell",
  },
  {
    name: "heap tuples",
    source: `def solve(points, k):
    heap = []
    for x, y in points:
        heappush(heap, (x * x + y * y, x, y))
    return [heappop(heap)[1:] for _ in range(k)]`,
    entrypoint: "solve",
    arguments: [[[3, 3], [1, 2], [0, 1]], 2],
    expectedReturn: "0112",
    expectedProjection: ".sequence-cell",
  },
  {
    name: "defaultdict graph",
    source: `def solve(edges):
    graph = defaultdict(list)
    indegree = defaultdict(int)
    for source, target in edges:
        graph[source].append(target)
        indegree[target] += 1
        indegree[source] += 0
    queue = deque(node for node in graph if indegree[node] == 0)
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
    arguments: [[[0, 1], [0, 2], [1, 3], [2, 3]]],
    expectedReturn: "0123",
    expectedProjection: ".mapping-row",
  },
  {
    name: "linked list descriptor",
    source: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def solve(head):
    previous = None
    current = head
    while current:
        following = current.next
        current.next = previous
        previous = current
        current = following
    return previous`,
    entrypoint: "solve",
    arguments: [{
      $kind: "object",
      type: "ListNode",
      id: "one",
      fields: {
        val: 1,
        next: {
          $kind: "object",
          type: "ListNode",
          id: "two",
          fields: {
            val: 2,
            next: {
              $kind: "object",
              type: "ListNode",
              id: "three",
              fields: { val: 3, next: null },
            },
          },
        },
      },
    }],
    expectedReturn: "3",
    expectedProjection: ".relation-node",
  },
  {
    name: "binary tree recursion",
    source: `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def solve(root):
    best = 0
    def depth(node):
        nonlocal best
        if node is None:
            return 0
        left = depth(node.left)
        right = depth(node.right)
        best = max(best, left + right)
        return max(left, right) + 1
    depth(root)
    return best`,
    entrypoint: "solve",
    arguments: [{
      $kind: "object",
      type: "TreeNode",
      id: "root",
      fields: {
        val: 1,
        left: {
          $kind: "object",
          type: "TreeNode",
          fields: { val: 2, left: null, right: null },
        },
        right: {
          $kind: "object",
          type: "TreeNode",
          fields: { val: 3, left: null, right: null },
        },
      },
    }],
    expectedReturn: "2",
    expectedProjection: ".relation-node",
  },
  {
    name: "nested comprehension",
    source: `def solve(nums):
    groups = {parity: [value * value for value in nums if value % 2 == parity]
              for parity in (0, 1)}
    return groups`,
    entrypoint: "solve",
    arguments: [[1, 2, 3, 4]],
    expectedReturn: "416",
    expectedProjection: ".mapping-row",
  },
  {
    name: "matrix mutation",
    source: `def solve(matrix):
    size = len(matrix)
    for row in range(size):
        for column in range(row + 1, size):
            matrix[row][column], matrix[column][row] = (
                matrix[column][row], matrix[row][column]
            )
    for row in matrix:
        row.reverse()
    return matrix`,
    entrypoint: "solve",
    arguments: [[[1, 2], [3, 4]]],
    expectedReturn: "3142",
    expectedProjection: ".grid-cell",
  },
  {
    name: "slots object",
    source: `class Counter:
    __slots__ = ("value",)
    def __init__(self):
        self.value = 0
    def add(self, amount):
        self.value += amount

def solve(nums):
    counter = Counter()
    for value in nums:
        counter.add(value)
    return counter.value`,
    entrypoint: "solve",
    arguments: [[2, 5, 8]],
    expectedReturn: "15",
    expectedProjection: ".relation-node",
  },
  {
    name: "walrus and set",
    source: `def solve(nums):
    seen = set()
    output = []
    for value in nums:
        if (square := value * value) not in seen:
            seen.add(square)
            output.append(square)
    return output`,
    entrypoint: "solve",
    arguments: [[2, -2, 3, 2]],
    expectedReturn: "49",
    expectedProjection: ".sequence-cell",
  },
  {
    name: "bitmask dynamic programming",
    source: `def solve(cost):
    size = len(cost)
    dp = {0: 0}
    for mask in range(1 << size):
        if mask not in dp:
            continue
        worker = mask.bit_count()
        if worker == size:
            continue
        for job in range(size):
            if not (mask >> job) & 1:
                next_mask = mask | (1 << job)
                candidate = dp[mask] + cost[worker][job]
                dp[next_mask] = min(dp.get(next_mask, 10 ** 9), candidate)
    return dp[(1 << size) - 1]`,
    entrypoint: "solve",
    arguments: [[[9, 2, 7], [6, 4, 3], [5, 8, 1]]],
    expectedReturn: "9",
    expectedProjection: ".mapping-row",
  },
];

async function setSource(page: import("@playwright/test").Page, source: string) {
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
}

function serializedText(value: unknown, depth = 0): string {
  if (
    depth > 12 ||
    typeof value !== "object" ||
    value === null
  ) {
    return "";
  }
  const serialized = value as {
    kind?: string;
    value?: unknown;
    items?: unknown[];
    entries?: Array<[unknown, unknown]>;
    fields?: Record<string, unknown>;
  };
  if (serialized.kind === "scalar") {
    return String(serialized.value ?? "");
  }
  if (serialized.kind === "sequence" || serialized.kind === "set") {
    return (serialized.items ?? [])
      .map((item) => serializedText(item, depth + 1))
      .join("");
  }
  if (serialized.kind === "mapping") {
    return (serialized.entries ?? [])
      .flatMap(([key, item]) => [
        serializedText(key, depth + 1),
        serializedText(item, depth + 1),
      ])
      .join("");
  }
  if (serialized.kind === "object") {
    return Object.values(serialized.fields ?? {})
      .map((item) => serializedText(item, depth + 1))
      .join("");
  }
  return "";
}

test("executes and visualizes an adversarial LeetCode-style corpus", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The corpus exercises language and compiler behavior once.",
  );
  test.setTimeout(360_000);
  await page.goto("/");
  await expect(page.locator(".visual-scene")).toBeVisible({ timeout: 100_000 });

  const selectedCases = process.env.TRACEFRAME_CASE
    ? cases.filter(({ name }) => name === process.env.TRACEFRAME_CASE)
    : cases;
  for (const candidate of selectedCases) {
    await test.step(candidate.name, async () => {
      await setSource(page, candidate.source);
      await page.getByLabel("Function entry point").fill(candidate.entrypoint);
      await page
        .getByLabel("Function arguments JSON")
        .fill(JSON.stringify(candidate.arguments));
      await page.getByRole("button", { name: "Run code" }).click();
      await expect(page.getByRole("button", { name: "Run code" })).toBeEnabled({
        timeout: 30_000,
      });
      await expect(page.locator(".error-banner")).toHaveCount(0);

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Save replay" }).click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      const replay = JSON.parse(
        await readFile(downloadPath!, "utf8"),
      ) as {
        trace: {
          frames: Array<{
            event: string;
            functionName: string;
            depth: number;
            returnValue?: unknown;
          }>;
          steps?: Array<{ index: number; event: string; functionName: string }>;
        };
      };
      const returnFrame = [...replay.trace.frames].reverse().find(
        (frame) =>
          frame.event === "return" &&
          frame.functionName === candidate.entrypoint &&
          frame.depth === 0,
      );
      expect(
        returnFrame,
        `${candidate.name} should retain its top-level return frame`,
      ).toBeDefined();
      expect(
        serializedText(returnFrame?.returnValue),
        `${candidate.name} should return the expected value`,
      ).toContain(candidate.expectedReturn);
      const returnStep = replay.trace.steps?.find(
        (step) =>
          step.event === "return" &&
          step.functionName === candidate.entrypoint,
      );
      expect(
        returnStep,
        `${candidate.name} should retain its return debugger step`,
      ).toBeDefined();

      const timeline = page.getByLabel("Execution timeline");
      const maximum = Number(await timeline.getAttribute("max"));
      expect(maximum, `${candidate.name} should have debugger steps`).toBeGreaterThan(0);
      await timeline.fill(String(returnStep!.index));
      await expect(page.locator(".visual-scene")).toHaveAttribute(
        "data-function-name",
        candidate.entrypoint,
      );
      await expect(
        page.locator(
          '[data-variable-aliases~="$return"], [data-entity-bindings~="$return"]',
        ),
        `${candidate.name} should render its return value`,
      ).toBeVisible();
      let largestCount = 0;
      for (let index = 0; index <= maximum; index += 1) {
        await timeline.fill(String(index));
        if (candidate.expectedProjection) {
          largestCount = Math.max(
            largestCount,
            await page.locator(candidate.expectedProjection).count(),
          );
        }
      }
      await timeline.fill(String(maximum));
      if (candidate.expectedProjection) {
        expect(
          largestCount,
          `${candidate.name} should expose its expected projection`,
        ).toBeGreaterThan(0);
      }
    });
  }
});
