import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * The site's own pages. The ~43,000 register records and the institution
 * pages are reachable from these and are deliberately not enumerated: whether
 * thin register pages belong in an index is a product decision, and a
 * sitemap would be the loudest possible yes.
 */
const PAGES: { path: string; changeFrequency: "daily" | "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/doniraj", changeFrequency: "daily", priority: 0.9 },
  { path: "/volunteer", changeFrequency: "daily", priority: 0.9 },
  { path: "/organisations", changeFrequency: "weekly", priority: 0.7 },
  { path: "/o-nama", changeFrequency: "monthly", priority: 0.5 },
  { path: "/pravila-privatnosti", changeFrequency: "yearly", priority: 0.3 },
  { path: "/uvjeti-koristenja", changeFrequency: "yearly", priority: 0.3 },
  { path: "/kolacici", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: path === "/" ? SITE_URL : `${SITE_URL}${path}`,
    changeFrequency,
    priority,
  }));
}
