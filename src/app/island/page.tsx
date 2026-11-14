import type { Metadata } from "@farm.js/core";
import { Island, type IslandParams } from "@/components/systo/island";

export const metadata: Metadata = {
  title: "Systo Island",
};

export default function IslandPage({ searchParams }: { searchParams?: IslandParams }) {
  return <Island params={searchParams} />;
}
