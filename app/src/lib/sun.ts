// Sunrise and sunset for a place and an Indian date, to show Navkarsi and Chauvihar times.
// NOAA's solar equations (accurate to about a minute in India), worked out without any network call.

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Minutes after midnight IST of sunrise and sunset on `date` (YYYY-MM-DD) at lat/lon, or null near the poles. */
export function sunTimes(date: string, lat: number, lon: number): { sunrise: number; sunset: number } | null {
  const [y, m, d] = date.split("-").map(Number);
  // Julian century from J2000, at local noon.
  const jd = Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5 - lon / 360;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const C = Math.sin(rad(M)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * M)) * 0.000289;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const yv = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(yv * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * yv * Math.sin(rad(M)) * Math.cos(2 * rad(L0))
    - 0.5 * yv * yv * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
  // The sun's upper edge on the horizon, with refraction: -0.833°.
  const cosH = (Math.cos(rad(90.833)) - Math.sin(rad(lat)) * Math.sin(rad(decl))) / (Math.cos(rad(lat)) * Math.cos(rad(decl)));
  if (cosH < -1 || cosH > 1) return null;
  const ha = deg(Math.acos(cosH));
  const noonUtc = 720 - 4 * lon - eqTime; // minutes after UTC midnight
  const IST = 330;
  return { sunrise: Math.round(noonUtc - 4 * ha + IST), sunset: Math.round(noonUtc + 4 * ha + IST) };
}

/** 412 → "6:52 am". */
export function clock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Navkarsi ends 48 minutes (two ghadi) after sunrise. Chauvihar is kept by eating before sunset. */
export const NAVKARSI_AFTER_SUNRISE_MIN = 48;

export type TimeHint = "navkarsi" | "chauvihar";

/** Cities members are likely in, so an admin can pick one instead of sharing a location. */
export const CITIES: { name: string; lat: number; lon: number }[] = [
  { name: "Ahmedabad", lat: 23.0225, lon: 72.5714 }, { name: "Bengaluru", lat: 12.9716, lon: 77.5946 },
  { name: "Bhavnagar", lat: 21.7645, lon: 72.1519 }, { name: "Bhopal", lat: 23.2599, lon: 77.4126 },
  { name: "Chennai", lat: 13.0827, lon: 80.2707 }, { name: "Delhi", lat: 28.6139, lon: 77.209 },
  { name: "Hyderabad", lat: 17.385, lon: 78.4867 }, { name: "Indore", lat: 22.7196, lon: 75.8577 },
  { name: "Jaipur", lat: 26.9124, lon: 75.7873 }, { name: "Jamnagar", lat: 22.4707, lon: 70.0577 },
  { name: "Jodhpur", lat: 26.2389, lon: 73.0243 }, { name: "Kolkata", lat: 22.5726, lon: 88.3639 },
  { name: "Mumbai", lat: 19.076, lon: 72.8777 }, { name: "Nagpur", lat: 21.1458, lon: 79.0882 },
  { name: "Palitana", lat: 21.5254, lon: 71.8233 }, { name: "Pune", lat: 18.5204, lon: 73.8567 },
  { name: "Rajkot", lat: 22.3039, lon: 70.8022 }, { name: "Surat", lat: 21.1702, lon: 72.8311 },
  { name: "Udaipur", lat: 24.5854, lon: 73.7125 }, { name: "Vadodara", lat: 22.3072, lon: 73.1812 },
];
