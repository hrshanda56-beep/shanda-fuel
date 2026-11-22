/**
 * The company's own logo and colour, kept in the browser for the rest of the visit so the loading
 * truck can wear them. It is asked for once per company after the first page has shown, so a first
 * load (nothing known yet) and a company without a logo both draw the plain truck. It holds only the
 * company's own look, never page data, and starts empty on every full page load.
 */
export type RememberedBrand = Readonly<{
  logo: string | null;
  colour: string | null;
  /** Which tank colour shows the logo best: a logo with white lettering needs a dark tank. */
  tank: 'light' | 'dark';
}>;

const LIGHT_PLATE = 246;
const DARK_PLATE = 35;
const TOO_CLOSE = 60;

/**
 * Picks the tank colour that hides the least of a logo. Each opaque pixel is "lost" on a plate when
 * its brightness is within a small distance of the plate's; the plate that loses less wins. This is
 * why white lettering (the T.E.I Oils logo) gets a dark tank and black artwork gets a light one.
 */
export function chooseTank(rgba: ArrayLike<number>): 'light' | 'dark' {
  let lostOnLight = 0;
  let lostOnDark = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const alpha = rgba[i + 3]! / 255;
    if (alpha < 0.15) continue;
    const brightness = 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
    if (Math.abs(brightness - LIGHT_PLATE) < TOO_CLOSE) lostOnLight += alpha;
    if (Math.abs(brightness - DARK_PLATE) < TOO_CLOSE) lostOnDark += alpha;
  }
  return lostOnDark < lostOnLight ? 'dark' : 'light';
}

let brand: RememberedBrand | null = null;
let askedFor: string | null = null;

/** The brand of the company the visit is in, or null while unknown (plain truck). */
export function recallBrand(): RememberedBrand | null {
  return brand;
}

/** Only well-formed values are kept, so the truck never draws something unexpected. */
export function sanitiseBrand(
  value: unknown,
): { -readonly [K in keyof RememberedBrand]: RememberedBrand[K] } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { logo, colour } = value as { logo?: unknown; colour?: unknown };
  return {
    tank: 'light',
    logo:
      typeof logo === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(logo)
        ? logo
        : null,
    colour: typeof colour === 'string' && /^#[0-9A-Fa-f]{6}$/.test(colour) ? colour : null,
  };
}

/** Reads the logo's pixels in the browser to pick the tank colour; the light tank if that fails. */
async function tankFor(logo: string): Promise<'light' | 'dark'> {
  try {
    const image = new Image();
    image.src = logo;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(120, image.naturalWidth || 120);
    canvas.height = Math.max(
      1,
      Math.round((canvas.width * image.naturalHeight) / (image.naturalWidth || 1)),
    );
    const context = canvas.getContext('2d');
    if (!context) return 'light';
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return chooseTank(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    return 'light';
  }
}

/** Asks for the company's brand once; a second call for the same company does nothing. */
export async function loadBrand(tenantId: string, doFetch: typeof fetch = fetch): Promise<void> {
  if (askedFor === tenantId) return;
  askedFor = tenantId;
  brand = null;
  try {
    const response = await doFetch(`/api/brand?tenantId=${encodeURIComponent(tenantId)}`, {
      credentials: 'same-origin',
    });
    if (!response.ok) return;
    const body = (await response.json()) as { data?: unknown };
    const found = sanitiseBrand(body.data);
    if (found?.logo) found.tank = await tankFor(found.logo);
    if (askedFor === tenantId) brand = found;
  } catch {
    // The plain truck is always a fine answer.
  }
}

/** For tests. */
export function resetBrandMemory() {
  brand = null;
  askedFor = null;
}
