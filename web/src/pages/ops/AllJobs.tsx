import { JobsExplorer } from "@/components/JobsExplorer";
import { PageHeader } from "@/components/ui";

export default function AllJobs() {
  return (
    <div>
      <PageHeader title="All jobs" description="Cross-tenant request log. Filter by tenant or status, and open any row to inspect it." />
      <JobsExplorer admin />
    </div>
  );
}
