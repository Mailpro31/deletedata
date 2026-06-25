/** Forme normalisée intermédiaire produite par chaque parseur de source. */
export interface RawBroker {
  slug: string;
  name: string;
  optOutUrl?: string;
  email?: string;
  /** us | eu | global | ... (libre, normalisé ensuite) */
  region?: string;
  /** people-search | marketing | background-check | ... (libre) */
  category?: string;
  requiresIdentityDoc?: boolean;
  source: string;
  sourceLicense: string;
}
