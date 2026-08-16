import { ProductionRail } from "@/components/app/production-rail";
import type { Id } from "@/convex/_generated/dataModel";
import type { ReactNode } from "react";

export default async function ProductionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ productionId: string }>;
}) {
  const { productionId } = await params;
  return (
    <div className="flex flex-1">
      <ProductionRail productionId={productionId as Id<"productions">} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
