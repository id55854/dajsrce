const PUBLIC_COMPANY_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export function isValidPublicCompanySlug(slug: string): boolean {
  return PUBLIC_COMPANY_SLUG.test(slug);
}

export function publicAppOrigin(request: Request): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];
  for (const configured of candidates) {
    if (!configured) continue;
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Try the next deployment-provided canonical origin.
    }
  }
  return new URL(request.url).origin;
}
