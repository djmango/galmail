import type { McpApprovalRequest } from "@galmail/mcp";
import { ActionButton } from "./ActionButton";

export function McpApprovalBanner(props: {
  pending: McpApprovalRequest[];
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  if (props.pending.length === 0) return null;
  const request = props.pending[0]!;

  return (
    <div className="mcp-approval-banner" role="alertdialog" aria-live="polite">
      <div className="mcp-approval-copy">
        <strong>MCP approval</strong>
        <span>
          {request.clientName} wants to {request.summary}
          {request.accountIds.length > 0
            ? ` · ${request.accountIds.length} account(s)`
            : ""}
        </span>
      </div>
      <div className="mcp-approval-actions">
        <ActionButton label="Deny" onClick={() => props.onDeny(request.id)} />
        <ActionButton
          label="Approve"
          onClick={() => props.onApprove(request.id)}
        />
      </div>
    </div>
  );
}
