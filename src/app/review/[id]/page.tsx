import { HumanReviewWorkspace } from "@/components/human-review-workspace";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HumanReviewWorkspace key={id} recordId={id} />;
}
