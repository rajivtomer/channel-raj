// Platform posting rules, shared by the composer (live hints) and the server (final check).
import type { MediaKind, Platform, TargetOptions } from "@/db/schema";

export const LIMITS = {
  instagramCaption: 2200,
  instagramHashtags: 30,
  instagramMaxMedia: 10,
  facebookCaption: 63206,
  youtubeTitle: 100,
  youtubeDescription: 5000,
  youtubeTags: 500,
} as const;

export const YOUTUBE_CATEGORIES: { id: string; name: string }[] = [
  { id: "22", name: "People & Blogs" },
  { id: "1", name: "Film & Animation" },
  { id: "2", name: "Autos & Vehicles" },
  { id: "10", name: "Music" },
  { id: "15", name: "Pets & Animals" },
  { id: "17", name: "Sports" },
  { id: "19", name: "Travel & Events" },
  { id: "20", name: "Gaming" },
  { id: "23", name: "Comedy" },
  { id: "24", name: "Entertainment" },
  { id: "25", name: "News & Politics" },
  { id: "26", name: "Howto & Style" },
  { id: "27", name: "Education" },
  { id: "28", name: "Science & Technology" },
  { id: "29", name: "Nonprofits & Activism" },
];

export interface MediaInfo {
  kind: MediaKind;
}

export const countHashtags = (text: string) => (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;

/** Problems that would stop this target from publishing. Empty means OK. */
export function validateTarget(
  platform: Platform,
  caption: string,
  media: MediaInfo[],
  options: TargetOptions,
): string[] {
  const errors: string[] = [];
  const videos = media.filter((m) => m.kind === "video").length;
  const images = media.length - videos;

  if (platform === "youtube") {
    const yt = options.youtube ?? {};
    if (videos !== 1 || images > 0) errors.push("YouTube needs exactly one video and no images.");
    if (!yt.title?.trim()) errors.push("Add a YouTube title.");
    if ((yt.title ?? "").length > LIMITS.youtubeTitle) errors.push(`YouTube titles are limited to ${LIMITS.youtubeTitle} characters.`);
    if (/[<>]/.test(yt.title ?? "") || /[<>]/.test(caption)) errors.push("YouTube doesn't allow < or > in titles or descriptions.");
    if (caption.length > LIMITS.youtubeDescription) errors.push(`YouTube descriptions are limited to ${LIMITS.youtubeDescription} characters.`);
    if ((yt.tags ?? "").length > LIMITS.youtubeTags) errors.push(`YouTube tags are limited to ${LIMITS.youtubeTags} characters in total.`);
  }

  if (platform === "instagram") {
    const format = options.instagram?.format ?? "feed";
    if (!media.length) errors.push("Instagram needs at least one photo or video.");
    if (media.length > LIMITS.instagramMaxMedia) errors.push(`Instagram carousels hold up to ${LIMITS.instagramMaxMedia} items.`);
    if (format === "reel" && (videos !== 1 || images > 0)) errors.push("A Reel needs exactly one video.");
    if (format === "story" && media.length !== 1) errors.push("A Story needs exactly one photo or video.");
    if (caption.length > LIMITS.instagramCaption) errors.push(`Instagram captions are limited to ${LIMITS.instagramCaption} characters.`);
    if (countHashtags(caption) > LIMITS.instagramHashtags) errors.push(`Instagram allows up to ${LIMITS.instagramHashtags} hashtags.`);
  }

  if (platform === "facebook") {
    if (!media.length && !caption.trim() && !options.facebook?.link) errors.push("Facebook needs text, a link or media.");
    if (videos > 1 || (videos === 1 && images > 0)) errors.push("Facebook posts can have one video, or several photos, not both.");
    if (caption.length > LIMITS.facebookCaption) errors.push("This caption is too long for Facebook.");
  }

  return errors;
}

/** Appends channel default hashtags and suffix, skipping ones already present. */
export function applyChannelDefaults(caption: string, defaults: { defaultHashtags?: string; captionSuffix?: string }) {
  let out = caption.trimEnd();
  const suffix = defaults.captionSuffix?.trim();
  if (suffix && !out.includes(suffix)) out += `\n\n${suffix}`;
  const tags = (defaults.defaultHashtags ?? "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .filter((t) => !new RegExp(`(^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(out));
  if (tags.length) out += `${out ? "\n\n" : ""}${tags.join(" ")}`;
  return out;
}
