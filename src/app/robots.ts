import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/**
 * Public discovery pages are crawlable; the JSON API, signed-in dashboards
 * and the auth flows are not content. The share image stays reachable, since
 * link-preview crawlers fetch it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/auth"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
