import { ShieldAlert } from "lucide-react";
import type { ApiKey } from "@/lib/types";
import { CopyButton, Modal } from "./ui";

export function KeyReveal({ apiKey, onClose, title = "Save your API key" }: { apiKey: ApiKey | null; onClose: () => void; title?: string }) {
  return (
    <Modal open={!!apiKey} onClose={onClose} title={title} footer={<button className="btn-primary" onClick={onClose}>I've saved it</button>}>
      <div className="space-y-4">
        <div className="flex gap-3 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm">
          <ShieldAlert className="h-4 w-4 text-warn shrink-0 mt-0.5" />
          <p>This is the only time the full key is shown. The gateway stores just a SHA-256 hash, so it can't be recovered later.</p>
        </div>
        <div>
          <div className="label">{apiKey?.name}</div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg p-2 pl-3">
            <code className="flex-1 font-mono text-xs break-all select-all">{apiKey?.key}</code>
            <CopyButton text={apiKey?.key ?? ""} label="Copy" />
          </div>
        </div>
      </div>
    </Modal>
  );
}
