import { Router } from "express";
import { PNG } from "pngjs";
import { storage, DepartmentChangeError } from "../storage";
import { getUserRoles, hasAnyRole, COACH_CAPTAIN, hasTbaKey, hasToaKey, hasNexusKey, invalidateApiKeyCache, getResolvedKeys } from "../helpers";
import { invalidateTeamTimezoneCache } from "../services/teamTime";
import { requireRoles } from "../middleware/auth";
import { EMPTY_DEPARTMENT_CHANGES, derivedRemovals } from "../../shared/departments";
import { sanitizeRequirements } from "./requirements";
import { LION_SHAPES, LION_BOUNDS, lionIconScale, lionIconSvg } from "../../shared/lionLogo";

const DEFAULT_THEME_HEX = '#4169e1';

// themeColor is operator-supplied and gets interpolated into served SVG markup,
// so it never leaves this function as anything but a literal hex triplet.
function safeHex(hex: unknown): string {
  return typeof hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim())
    ? hex.trim()
    : DEFAULT_THEME_HEX;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function fillRect(png: PNG, x0: number, y0: number, w: number, h: number, r: number, g: number, b: number, a = 255) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = a;
    }
  }
}

function compositeCenter(dst: PNG, src: PNG, targetX: number, targetY: number, targetW: number, targetH: number) {
  for (let dy = 0; dy < targetH; dy++) {
    for (let dx = 0; dx < targetW; dx++) {
      const sx = Math.round(dx * src.width / targetW);
      const sy = Math.round(dy * src.height / targetH);
      const si = (Math.min(sy, src.height - 1) * src.width + Math.min(sx, src.width - 1)) * 4;
      const di = ((targetY + dy) * dst.width + (targetX + dx)) * 4;
      const srcA = src.data[si + 3] / 255;
      if (srcA > 0) {
        dst.data[di]     = Math.round(src.data[si]     * srcA + dst.data[di]     * (1 - srcA));
        dst.data[di + 1] = Math.round(src.data[si + 1] * srcA + dst.data[di + 1] * (1 - srcA));
        dst.data[di + 2] = Math.round(src.data[si + 2] * srcA + dst.data[di + 2] * (1 - srcA));
        dst.data[di + 3] = 255;
      }
    }
  }
}

type Pt = [number, number];

/** Squared distance from p to segment ab — the primitive behind stroked shapes. */
function distSqToSegment(px: number, py: number, [ax, ay]: Pt, [bx, by]: Pt): number {
  const vx = bx - ax, vy = by - ay;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
}

function pointInPolygon(px: number, py: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shapeContains(shape: (typeof LION_SHAPES)[number], x: number, y: number): boolean {
  if (shape.kind === 'circle') {
    const dx = x - shape.cx, dy = y - shape.cy;
    return dx * dx + dy * dy <= shape.r * shape.r;
  }
  if (shape.kind === 'polygon') {
    if (pointInPolygon(x, y, shape.points)) return true;
    if (!shape.grow) return false;
    const g = shape.grow * shape.grow;
    // Closed perimeter, so the outset wraps the last edge back to the first.
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i], b = shape.points[(i + 1) % shape.points.length];
      if (distSqToSegment(x, y, a, b) <= g) return true;
    }
    return false;
  }
  const half = (shape.w / 2) ** 2;
  for (let i = 0; i < shape.points.length - 1; i++) {
    if (distSqToSegment(x, y, shape.points[i], shape.points[i + 1]) <= half) return true;
  }
  return false;
}

/**
 * Paint the lion over an already-background-filled PNG. Shapes are painted in
 * order (last one wins), sampled 3x3 per pixel so the curves land smooth at
 * icon sizes. This is the raster twin of lionIconSvg().
 */
function drawLion(png: PNG, size: number, theme: { r: number; g: number; b: number }) {
  const s = lionIconScale();
  const SS = 3, inv = 1 / SS;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let white = 0, colored = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          // pixel -> 0..100 icon space -> lion's own coordinates
          const ix = ((px + (sx + 0.5) * inv) / size) * 100;
          const iy = ((py + (sy + 0.5) * inv) / size) * 100;
          const wx = (ix - 50) / s + LION_BOUNDS.cx;
          const wy = (iy - 50) / s + LION_BOUNDS.cy;
          // Most samples are background; one radius check beats 25 shape tests.
          const bx = wx - LION_BOUNDS.cx, by = wy - LION_BOUNDS.cy;
          if (bx * bx + by * by > LION_BOUNDS.radius * LION_BOUNDS.radius) continue;
          for (let i = LION_SHAPES.length - 1; i >= 0; i--) {
            if (shapeContains(LION_SHAPES[i], wx, wy)) {
              if (LION_SHAPES[i].ink === 'white') white++;
              else colored++;
              break;
            }
          }
        }
      }
      const total = SS * SS;
      if (white === 0) continue; // only white ink differs from the background
      const a = white / total;
      const idx = (py * size + px) * 4;
      png.data[idx]     = Math.round(255 * a + theme.r * (1 - a));
      png.data[idx + 1] = Math.round(255 * a + theme.g * (1 - a));
      png.data[idx + 2] = Math.round(255 * a + theme.b * (1 - a));
      png.data[idx + 3] = 255;
      void colored;
    }
  }
}

// The icon only changes when the team's branding does, but browsers request it
// on every load — so rasterizing it is memoised rather than repeated.
let iconPngCache: { key: string; buf: Buffer } | null = null;

const router = Router();

const DEFAULT_DEPARTMENTS = [
  { name: 'Mechanical', color: '#f97316' },
  { name: 'Software', color: '#3b82f6' },
  { name: 'Modeling', color: '#8b5cf6' },
  { name: 'Logistics', color: '#22c55e' },
  { name: 'Electrical', color: '#eab308' },
  { name: 'Business', color: '#14b8a6' },
  { name: 'Leadership', color: '#ef4444' },
];

const DEFAULT_ROLES = [
  { name: 'Coach', tier: 'leadership' },
  { name: 'Team Captain', tier: 'leadership' },
  { name: 'SCRUM Master', tier: 'leadership' },
  { name: 'Department Head', tier: 'lead' },
  { name: 'Trainer', tier: 'lead' },
  { name: 'Team Member', tier: 'member' },
  { name: 'Class Member', tier: 'member' },
];

// Never expose stored API keys to clients. The UI reads presence/absence from
// GET /settings/api-status (booleans) instead.
function stripApiKeys(settings: any) {
  const { tbaApiKey, toaApiKey, nexusApiKey, ...safe } = settings;
  return safe;
}

router.get("/settings", async (req, res) => {
  try {
    const settings = await storage.getTeamSettings();
    res.json(stripApiKeys(settings));
  } catch (error) {
    console.error("Error fetching team settings:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { requesterId, departmentChanges, ...data } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN)) {
      return res.status(403).json({ error: "Only Coaches or Captains can modify team settings" });
    }

    // `requirements` is a JSONB blob with no other validation, and feeds a
    // loop in computeRequirements — coerce it into shape here. Guarded by
    // `!== undefined` because upsertTeamSettings is a blind column write: a
    // partial save that omits `requirements` (e.g. a departments-only save)
    // must leave the stored value untouched.
    if (data.requirements !== undefined) {
      try {
        data.requirements = sanitizeRequirements(data.requirements);
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    // Partial saves that don't touch departments (e.g. RequirementsSettings)
    // have nothing to reconcile or propagate — keep the old, simpler path.
    if (data.departments === undefined) {
      const settings = await storage.upsertTeamSettings(data);
      invalidateTeamTimezoneCache();
      return res.json(stripApiKeys(settings));
    }

    const { settings, propagation } = await storage.updateTeamSettingsWithDepartmentChanges(
      data,
      departmentChanges ?? EMPTY_DEPARTMENT_CHANGES,
    );
    invalidateTeamTimezoneCache();
    res.json({ ...stripApiKeys(settings), departmentPropagation: propagation });
  } catch (error) {
    if (error instanceof DepartmentChangeError) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error updating team settings:", error);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

router.post("/settings/reset", async (req, res) => {
  try {
    const { requesterId } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN)) {
      return res.status(403).json({ error: "Only Coaches or Captains can reset team settings" });
    }

    // Resetting departments back to the defaults is exactly as destructive as
    // deleting every custom one at once — route it through the same
    // propagation path instead of orphaning every reference in one shot.
    // NOTE: `roles` has the identical bug on reset (custom roles vanish from
    // team_settings while users.roles keeps them) — out of scope here.
    const current = await storage.getTeamSettings();
    const changes = derivedRemovals(
      (current.departments as { name: string }[]).map(d => d.name),
      DEFAULT_DEPARTMENTS.map(d => d.name),
    );
    const { settings, propagation } = await storage.updateTeamSettingsWithDepartmentChanges(
      {
        teamNumber: 31130,
        teamName: 'ManeFrame',
        themeColor: '#4169e1',
        logoUrl: null,
        teamProgram: 'FTC',
        timezone: 'America/Los_Angeles',
        departments: DEFAULT_DEPARTMENTS,
        roles: DEFAULT_ROLES,
      },
      changes,
    );
    invalidateTeamTimezoneCache();
    res.json({ ...stripApiKeys(settings), departmentPropagation: propagation });
  } catch (error) {
    console.error("Error resetting team settings:", error);
    res.status(500).json({ error: "Failed to reset settings" });
  }
});

router.get("/settings/department-usage", requireRoles(...COACH_CAPTAIN), async (_req, res) => {
  try {
    res.json(await storage.getDepartmentUsageCounts());
  } catch (error) {
    console.error("Error fetching department usage:", error);
    res.status(500).json({ error: "Failed to load department usage" });
  }
});

router.get("/settings/pwa-icon.png", async (req, res) => {
  try {
    const settings = await storage.getTeamSettings();
    const themeHex = safeHex(settings.themeColor as string);
    const logoUrl  = settings.logoUrl as string | null;
    const SIZE = 512;
    const c = hexToRgb(themeHex);

    const cacheKey = `${SIZE}|${themeHex}|${logoUrl ?? 'lion'}`;
    if (iconPngCache?.key === cacheKey) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(iconPngCache.buf);
    }

    const dst = new PNG({ width: SIZE, height: SIZE, filterType: -1 });
    // Initialise buffer to theme color
    fillRect(dst, 0, 0, SIZE, SIZE, c.r, c.g, c.b);

    if (logoUrl) {
      // White inset (the "border" effect)
      fillRect(dst, 36, 36, SIZE - 72, SIZE - 72, 255, 255, 255);
      // Decode stored base64 logo and composite centred
      const base64 = logoUrl.replace(/^data:image\/\w+;base64,/, '');
      const logoBuf = Buffer.from(base64, 'base64');
      const logoPng = PNG.sync.read(logoBuf);
      compositeCenter(dst, logoPng, 64, 64, SIZE - 128, SIZE - 128);
    } else {
      // No uploaded logo: the team lion, matching the favicon and the in-app badge.
      drawLion(dst, SIZE, c);
    }

    const out = PNG.sync.write(dst);
    iconPngCache = { key: cacheKey, buf: out };
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(out);
  } catch (error) {
    console.error("Error generating PWA PNG icon:", error);
    res.redirect('/icon-192.png');
  }
});

router.get("/settings/pwa-icon.svg", async (req, res) => {
  try {
    const settings = await storage.getTeamSettings();
    const color = safeHex(settings.themeColor as string);
    const logo = settings.logoUrl as string | null;

    let innerContent: string;
    if (logo) {
      // Logo image centered inside a white padded inset (border = theme color background)
      innerContent = `
  <rect x="36" y="36" width="440" height="440" rx="56" fill="white"/>
  <image x="64" y="64" width="384" height="384" href="${logo}" preserveAspectRatio="xMidYMid meet" clip-path="url(#imgClip)"/>`;
    } else {
      // No uploaded logo: the team lion. Drawn on a 100x100 grid, so scale to 512.
      // The team number is deliberately omitted — it is unreadable at favicon
      // size and costs the lion the room it needs to be recognisable.
      innerContent = `
  <g transform="scale(5.12)">${lionIconSvg(color)}</g>`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="imgClip">
      <rect x="64" y="64" width="384" height="384" rx="44"/>
    </clipPath>
  </defs>
  <rect width="512" height="512" rx="80" fill="${color}"/>${innerContent}
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(svg);
  } catch (error) {
    console.error("Error generating PWA icon:", error);
    res.status(500).send('Error generating icon');
  }
});

router.get("/settings/tba-logo", async (req, res) => {
  try {
    const teamNum = req.query.team as string;
    if (!teamNum) return res.status(400).json({ error: "team query param required" });

    const { tba: apiKey } = await getResolvedKeys();
    if (!apiKey) return res.status(500).json({ error: "TBA API key not configured" });

    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1, currentYear + 1];

    for (const year of years) {
      const url = `https://www.thebluealliance.com/api/v3/team/frc${teamNum}/media/${year}`;
      const response = await fetch(url, {
        headers: { "X-TBA-Auth-Key": apiKey },
      });
      if (!response.ok) continue;
      const media: any[] = await response.json();
      const match = media.find((m: any) =>
        ['avatar', 'logo'].includes(m.type) && m.details?.base64Image
      );
      if (match) {
        return res.json({ logoUrl: `data:image/png;base64,${match.details.base64Image}` });
      }
    }

    res.json({ logoUrl: null });
  } catch (error) {
    console.error("Error fetching TBA logo:", error);
    res.status(500).json({ error: "Failed to fetch TBA logo" });
  }
});

router.get("/settings/toa-logo", async (req, res) => {
  try {
    const teamNum = req.query.team as string;
    if (!teamNum) return res.status(400).json({ error: "team query param required" });
    const { toa: apiKey } = await getResolvedKeys();
    if (!apiKey) return res.status(503).json({ error: "TOA API key not configured" });

    const teamKey = `ftc${teamNum}`;
    const response = await fetch(`https://theorangealliance.org/api/team/${teamKey}/media`, {
      headers: {
        "X-TOA-Key": apiKey,
        "X-Application-Origin": "ManeFrameHub",
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) return res.json({ logoUrl: null });
    const media: any[] = await response.json();
    const photo = Array.isArray(media) ? media.find((m: any) => m.url) : null;
    res.json({ logoUrl: photo ? photo.url : null });
  } catch (error) {
    console.error("Error fetching TOA logo:", error);
    res.status(500).json({ error: "Failed to fetch TOA logo" });
  }
});

router.get("/settings/api-status", async (_req, res) => {
  res.json({
    tba: await hasTbaKey(),
    toa: await hasToaKey(),
    nexus: await hasNexusKey(),
  });
});

router.put("/settings/api-keys", async (req, res) => {
  try {
    const { requesterId, tbaApiKey, toaApiKey, nexusApiKey } = req.body;
    if (!requesterId) return res.status(400).json({ error: "requesterId is required" });
    const actorRoles = await getUserRoles(parseInt(requesterId));
    if (!hasAnyRole(actorRoles, COACH_CAPTAIN)) {
      return res.status(403).json({ error: "Only Coaches or Captains can update API keys" });
    }
    const patch: Record<string, string | null> = {};
    if (tbaApiKey   !== undefined) patch.tbaApiKey   = tbaApiKey   || null;
    if (toaApiKey   !== undefined) patch.toaApiKey   = toaApiKey   || null;
    if (nexusApiKey !== undefined) patch.nexusApiKey = nexusApiKey || null;
    await storage.upsertTeamSettings(patch);
    invalidateApiKeyCache();
    res.json({ ok: true });
  } catch (error) {
    console.error("Error saving API keys:", error);
    res.status(500).json({ error: "Failed to save API keys" });
  }
});

export default router;
