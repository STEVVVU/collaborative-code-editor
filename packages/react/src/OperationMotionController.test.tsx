import type { OperationMotionPlan } from "@traceframe/core";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOperationMotion } from "./OperationMotionController";

const animateDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate",
);
const rectDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "getBoundingClientRect",
);

const plan: OperationMotionPlan = {
  id: "3:nums[0] + nums[1]:+:11",
  expression: "nums[0] + nums[1]",
  operandTexts: ["3", "8"],
  sourcePaths: ["nums[0]", "nums[1]"],
  operatorToken: "+",
  resultText: "11",
  targetPath: "left",
};

function rect(left: number, top: number, width = 40, height = 40): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  };
}

function Harness() {
  const rootRef = useRef<HTMLDivElement>(null);
  useOperationMotion(rootRef, 3, plan, 480);
  return (
    <div ref={rootRef}>
      <div className="primary-variables">
        <span data-motion-anchor="value" data-projection-path="nums[0]">3</span>
        <span data-motion-anchor="value" data-projection-path="nums[1]">8</span>
        <span data-motion-anchor="value" data-projection-path="left">11</span>
      </div>
    </div>
  );
}

afterEach(() => {
  if (animateDescriptor) {
    Object.defineProperty(HTMLElement.prototype, "animate", animateDescriptor);
  } else {
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
  if (rectDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "getBoundingClientRect",
      rectDescriptor,
    );
  }
});

describe("operation choreography", () => {
  it("gathers source values while hiding the pending destination", () => {
    const animate = vi.fn(() => ({
      cancel: vi.fn(),
      finished: new Promise<never>(() => undefined),
    }));
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        const path = this.dataset?.projectionPath;
        if (path === "nums[0]") {
          return rect(120, 80);
        }
        if (path === "nums[1]") {
          return rect(180, 80);
        }
        if (path === "left") {
          return rect(420, 360);
        }
        if (this.classList?.contains("primary-variables")) {
          return rect(0, 0, 600, 420);
        }
        return rect(0, 0, 600, 500);
      },
    });

    const { container } = render(<Harness />);

    expect(container.querySelectorAll(".operation-motion-operand"))
      .toHaveLength(2);
    expect(container.querySelector(".operation-motion-operator"))
      .toHaveTextContent("+");
    expect(container.querySelector(".operation-motion-result"))
      .toHaveTextContent("11");
    expect(
      container.querySelector<HTMLElement>('[data-projection-path="left"]')
        ?.style.opacity,
    ).toBe("0");
    expect(animate.mock.calls[0]?.[1]).toMatchObject({
      duration: 312,
    });
  });

  it("reveals the destination after the result settles", async () => {
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: vi.fn(() => ({
        cancel: vi.fn(),
        finished: Promise.resolve(),
      })),
    });
    Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        if (this.classList?.contains("primary-variables")) {
          return rect(0, 0, 600, 420);
        }
        return rect(100, 80);
      },
    });

    const { container } = render(<Harness />);

    await waitFor(() => {
      expect(container.querySelector(".operation-motion-layer")).toBeNull();
    });
    expect(
      container.querySelector<HTMLElement>('[data-projection-path="left"]')
        ?.style.opacity,
    ).toBe("");
  });
});
