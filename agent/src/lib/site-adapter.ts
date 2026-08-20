export const SITE_ADAPTERS = ['generic', 'drupal'] as const;

export type SiteAdapterName = (typeof SITE_ADAPTERS)[number];

export function isSiteAdapterName(raw: string): raw is SiteAdapterName {
  return raw === 'generic' || raw === 'drupal';
}

export function resolveSiteAdapter(raw?: string): SiteAdapterName {
  const v = (raw ?? '').toLowerCase().trim();
  return isSiteAdapterName(v) ? v : 'generic';
}

export function isDrupalAdapter(adapter?: string): boolean {
  return resolveSiteAdapter(adapter) === 'drupal';
}
