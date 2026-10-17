import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSceneMotion } from "./SceneMotionController";

const animateDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "animate",
);
const rectDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "getBoundingClientRect",
);

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

function SharedView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState(false);
  useSceneMotion(rootRef, 0, { motions: [] }, detail ? "shared" : "overview", 320);

  return (
    <div ref={rootRef}>
      {detail ? (
        <div data-motion-key="shared" data-motion-anchor="container">
          detail
        </div>
      ) : (
        <button
          data-motion-key="shared"
          data-motion-anchor="entity"
          onClick={() => setDetail(true)}
          type="button"
        >
          node
        </button>
      )}
    </div>
  );
}

function DisclosedView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(false);
  useSceneMotion(
    rootRef,
    0,
    { motions: [] },
    detail ? "entity" : "overview",
    320,
    expanded ? "expanded" : "collapsed",
  );

  return (
    <div ref={rootRef}>
      <button onClick={() => setExpanded(true)} type="button">Expand relationships</button>
      {expanded && !detail && <button data-motion-key="entity" data-motion-anchor="entity" onClick={() => setDetail(true)} type="button">node</button>}
      {detail && <div data-motion-key="entity" data-motion-anchor="container">detail</div>}
    </div>
  );
}

describe("scene view motion", () => {
  it("animates a shared entity when semantic zoom changes without a new frame", () => {
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
        const detail = this.textContent === "detail";
        return {
          bottom: detail ? 250 : 40,
          height: detail ? 100 : 40,
          left: detail ? 200 : 0,
          right: detail ? 400 : 40,
          toJSON: () => ({}),
          top: detail ? 150 : 0,
          width: detail ? 200 : 40,
          x: detail ? 200 : 0,
          y: detail ? 150 : 0,
        };
      },
    });

    render(<SharedView />);
    fireEvent.click(screen.getByRole("button", { name: "node" }));

    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 320 });
    expect(document.querySelector(".scene-motion-ghost")).toHaveTextContent("node");
  });

  it("refreshes anchors on disclosure without animating expansion, then animates detail zoom", () => {
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
        const detail = this.textContent === "detail";
        return {
          bottom: detail ? 250 : 40,
          height: detail ? 100 : 40,
          left: detail ? 200 : 0,
          right: detail ? 400 : 40,
          toJSON: () => ({}),
          top: detail ? 150 : 0,
          width: detail ? 200 : 40,
          x: detail ? 200 : 0,
          y: detail ? 150 : 0,
        };
      },
    });

    const { container } = render(<DisclosedView />);
    fireEvent.click(screen.getByRole("button", { name: "Expand relationships" }));
    expect(animate).not.toHaveBeenCalled();
    expect(container.querySelector(".scene-motion-ghost")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "node" }));
    expect(animate).toHaveBeenCalledOnce();
    expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 320 });
    expect(container.querySelector(".scene-motion-ghost")).toHaveTextContent("node");
  });
});
