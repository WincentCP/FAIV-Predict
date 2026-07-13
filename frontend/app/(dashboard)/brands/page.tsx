"use client";

import { SectionHeader } from "@/components/SectionHeader";
import { BrandWorkspaces } from "./_components/BrandWorkspaces";
import { ModelEvidence } from "./_components/ModelEvidence";

/**
 * Brands merges the former Brands and Model Health pages: a model belongs to
 * a brand, and users think in brands. Workspaces and connections come first;
 * the full evaluation evidence lives in the Model quality section below.
 */
export default function BrandsPage() {
  return (
    <div className="mx-auto min-h-dvh max-w-[1400px] space-y-10 px-4 py-6 md:px-8 md:py-8">
      <SectionHeader
        title="Brands"
        description="Workspaces, Instagram connections, and model quality in one place."
      />
      <BrandWorkspaces />
      <div className="border-t border-border pt-8">
        <ModelEvidence />
      </div>
    </div>
  );
}
