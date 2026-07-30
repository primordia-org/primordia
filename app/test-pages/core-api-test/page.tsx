import type { Metadata } from "next";
import { buildPageTitle } from "@/lib/page-title";
import CoreApiScalarClient from "./CoreApiScalarClient";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: buildPageTitle("Core API Test"),
    description: "Explore the Primordia Core route-action API with Scalar.",
  };
}

export default function CoreApiTestPage() {
  return <CoreApiScalarClient />;
}
