import type { RunSpec } from "@traceframe/core";

export interface Example {
  id: string;
  name: string;
  source: string;
  runSpec: RunSpec;
}

export const examples: Example[] = [
  {
    id: "bubble-sort",
    name: "Bubble sort",
    source: `def bubble_sort(nums):
    for end in range(len(nums) - 1, 0, -1):
        swapped = False
        for index in range(end):
            if nums[index] > nums[index + 1]:
                nums[index], nums[index + 1] = nums[index + 1], nums[index]
                swapped = True
        if not swapped:
            break
    return nums
`,
    runSpec: {
      mode: "function",
      entrypoint: "bubble_sort",
      arguments: [[5, 1, 4, 2, 8]],
    },
  },
  {
    id: "grid-walk",
    name: "Grid walk",
    source: `def grid_sum(grid):
    total = 0
    for row in range(len(grid)):
        for column in range(len(grid[row])):
            total += grid[row][column]
    return total
`,
    runSpec: {
      mode: "function",
      entrypoint: "grid_sum",
      arguments: [[[1, 2, 3], [4, 5, 6], [7, 8, 9]]],
    },
  },
  {
    id: "linked-list",
    name: "Linked list",
    source: `class Node:
    def __init__(self, value, next_node=None):
        self.value = value
        self.next = next_node

def linked_list_sum(values):
    head = None
    for value in reversed(values):
        head = Node(value, head)

    current = head
    total = 0
    while current is not None:
        total += current.value
        current = current.next
    return total
`,
    runSpec: {
      mode: "function",
      entrypoint: "linked_list_sum",
      arguments: [[1, 2, 3]],
    },
  },
  {
    id: "binary-tree",
    name: "Binary tree DFS",
    source: `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

class Solution:
    def inorderTraversal(self, root):
        result = []

        def walk(node):
            if node is None:
                return
            walk(node.left)
            result.append(node.val)
            walk(node.right)

        walk(root)
        return result
`,
    runSpec: {
      mode: "function",
      entrypoint: "Solution.inorderTraversal",
      arguments: [
        {
          $kind: "object",
          type: "TreeNode",
          id: "root",
          fields: {
            val: 8,
            left: {
              $kind: "object",
              type: "TreeNode",
              fields: {
                val: 3,
                left: {
                  $kind: "object",
                  type: "TreeNode",
                  fields: { val: 1, left: null, right: null },
                },
                right: {
                  $kind: "object",
                  type: "TreeNode",
                  fields: { val: 6, left: null, right: null },
                },
              },
            },
            right: {
              $kind: "object",
              type: "TreeNode",
              fields: {
                val: 10,
                left: null,
                right: {
                  $kind: "object",
                  type: "TreeNode",
                  fields: { val: 14, left: null, right: null },
                },
              },
            },
          },
        },
      ],
    },
  },
  {
    id: "invert-tree",
    name: "Invert binary tree",
    source: `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

class Solution:
    def invertTree(self, root):
        if root is None:
            return None

        root.left, root.right = root.right, root.left
        self.invertTree(root.left)
        self.invertTree(root.right)
        return root
`,
    runSpec: {
      mode: "function",
      entrypoint: "Solution.invertTree",
      arguments: [
        {
          $kind: "object",
          type: "TreeNode",
          id: "root",
          fields: {
            val: 1,
            left: {
              $kind: "object",
              type: "TreeNode",
              id: "left",
              fields: {
                val: 2,
                left: {
                  $kind: "object",
                  type: "TreeNode",
                  fields: { val: 4, left: null, right: null },
                },
                right: {
                  $kind: "object",
                  type: "TreeNode",
                  fields: { val: 5, left: null, right: null },
                },
              },
            },
            right: {
              $kind: "object",
              type: "TreeNode",
              id: "right",
              fields: {
                val: 3,
                left: {
                  $kind: "object",
                  type: "TreeNode",
                  fields: { val: 6, left: null, right: null },
                },
                right: {
                  $kind: "object",
                  type: "TreeNode",
                  fields: { val: 7, left: null, right: null },
                },
              },
            },
          },
        },
      ],
    },
  },
  {
    id: "bfs",
    name: "Breadth-first search",
    source: `from collections import deque

def breadth_first_search(graph, start):
    queue = deque([start])
    visited = {start}
    order = []

    while queue:
        node = queue.popleft()
        order.append(node)
        for neighbor in graph[node]:
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append(neighbor)
    return order
`,
    runSpec: {
      mode: "function",
      entrypoint: "breadth_first_search",
      arguments: [
        [[1, 2], [0, 3, 4], [0, 5], [1], [1, 5], [2, 4]],
        0,
      ],
      projectionContracts: {
        version: 1,
        declarations: [
          {
            id: "bfs-graph",
            target: {
              root: { kind: "binding", name: "graph" },
              segments: [],
            },
            configuration: {
              kind: "graph",
              representation: "adjacency-list",
              directed: false,
            },
          },
        ],
      },
    },
  },
  {
    id: "two-sum",
    name: "Two sum",
    source: `def two_sum(nums, target):
    seen = {}
    for index, value in enumerate(nums):
        complement = target - value
        if complement in seen:
            return [seen[complement], index]
        seen[value] = index
    return []
`,
    runSpec: {
      mode: "function",
      entrypoint: "two_sum",
      arguments: [[2, 7, 11, 15], 9],
    },
  },
  {
    id: "two-pointer-scan",
    name: "Two-pointer scan",
    source: `def has_pair_with_sum(nums, target):
    left = 0
    right = len(nums) - 1

    while left < right:
        total = nums[left] + nums[right]
        if total == target:
            return True
        if total < target:
            left += 1
        else:
            right -= 1
    return False
`,
    runSpec: {
      mode: "function",
      entrypoint: "has_pair_with_sum",
      arguments: [[1, 2, 4, 7, 11, 15], 15],
    },
  },
  {
    id: "reverse-linked-list",
    name: "Reverse linked list",
    source: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class Solution:
    def reverseList(self, head):
        previous = None
        current = head
        while current is not None:
            following = current.next
            current.next = previous
            previous = current
            current = following
        return previous
`,
    runSpec: {
      mode: "function",
      entrypoint: "Solution.reverseList",
      arguments: [
        {
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
        },
      ],
    },
  },
  {
    id: "factorial",
    name: "Recursive factorial",
    source: `def factorial(number):
    if number <= 1:
        return 1
    return number * factorial(number - 1)
`,
    runSpec: {
      mode: "function",
      entrypoint: "factorial",
      arguments: [5],
    },
  },
  {
    id: "cyclic-list",
    name: "Cyclic linked list",
    source: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def cycle_sum(head, steps):
    total = 0
    current = head
    for _ in range(steps):
        total += current.val
        current = current.next
    return total
`,
    runSpec: {
      mode: "function",
      entrypoint: "cycle_sum",
      arguments: [
        {
          $kind: "object",
          type: "ListNode",
          id: "cycle-a",
          fields: {
            val: 4,
            next: {
              $kind: "object",
              type: "ListNode",
              id: "cycle-b",
              fields: {
                val: 9,
                next: { $kind: "reference", id: "cycle-a" },
              },
            },
          },
        },
        5,
      ],
    },
  },
  {
    id: "nested-structures",
    name: "Nested mixed structures",
    source: `def update_board(state):
    state["board"][1][0] += 5
    state["scores"]["blue"] += state["board"][1][0]
    state["history"].append(("blue", state["scores"]["blue"]))
    return state
`,
    runSpec: {
      mode: "function",
      entrypoint: "update_board",
      arguments: [
        {
          board: [[1, 2], [3, 4]],
          scores: { red: 7, blue: 6 },
          history: [["red", 7]],
        },
      ],
    },
  },
];
