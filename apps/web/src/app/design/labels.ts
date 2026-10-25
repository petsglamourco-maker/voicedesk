// Section labels for the gallery (en.json "design"); a plain module so the server page can use it.
export const GALLERY_LABELS = [
  "title",
  "description",
  "colours",
  "type",
  "buttons",
  "forms",
  "surfaces",
  "status",
  "kpis",
  "charts",
  "overlays",
  "controls",
  "display",
  "empty",
  "table",
  "dark",
  "light",
] as const;
export type GalleryLabels = Record<(typeof GALLERY_LABELS)[number], string>;
