import { Pause } from "lucide-react";
import type { ControlFlowProjection } from "@traceframe/core";

export interface ControlFlowViewProps {
  control: ControlFlowProjection;
}

export function ControlFlowView({ control }: ControlFlowViewProps) {
  if (control.suspendedCalls.length === 0) {
    return null;
  }
  return (
    <section className="suspended-section tf-enter" aria-label="Suspended calls">
      <header>
        <strong>Suspended</strong>
        <span>{control.suspendedCalls.length}</span>
      </header>
      <div className="suspended-list">
        {control.suspendedCalls.map((call) => (
          <div className="suspended-call" key={call.activationId}>
            <Pause size={12} aria-hidden="true" />
            <strong>{call.functionName}</strong>
            {call.yieldValue !== undefined && (
              <code>yield {call.yieldValue}</code>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
