import { JobsExplorer } from "@/components/JobsExplorer";
import { PageHeader } from "@/components/ui";

export default function Requests() {
  return (
    <div>
      <PageHeader
        title="Requests"
        description="Every async job and synchronous completion made with this workspace's keys. Click a row for timings, tokens and the full response."
      />
      <JobsExplorer />
    </div>
  );
}
