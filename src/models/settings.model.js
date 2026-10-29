import mongoose from "mongoose";

const pointsTableColorsSchema = new mongoose.Schema(
  {
    headerFrom: { type: String, default: "#4D78D6" },
    headerTo: { type: String, default: "#5A6EFF" },
    rankFrom: { type: String, default: "#001FFF" },
    rankTo: { type: String, default: "#5A96E6" },
    teamFrom: { type: String, default: "#001FFF" },
    teamTo: { type: String, default: "#5A96E6" },
    cellBg: { type: String, default: "#FFFFFF" },
    border: { type: String, default: "#3A3E5A" },
    borderSoft: { type: String, default: "#E6EEFF" },
    accent: { type: String, default: "#4D78D6" },
    aliveBar: { type: String, default: "#0000FF" },
    deadBar: { type: String, default: "#EF4444" },
    textPrimary: { type: String, default: "#0F172A" },
    panelFrom: { type: String, default: "#F5F8FF" },
    panelTo: { type: String, default: "#EAF2FF" },
    placeColor: { type: String, default: "#2563EB" },
    elimColor: { type: String, default: "#D97706" },
    totalColor: { type: String, default: "#0F172A" },
    danger: { type: String, default: "#DC2626" },
    warning: { type: String, default: "#F59E0B" },
    notificationFrom: { type: String, default: "#FFFFFF" },
    notificationTo: { type: String, default: "#EFF6FF" },
  },
  { _id: false }
);

const pointsTableColumnsSchema = new mongoose.Schema(
  {
    logo: { type: Boolean, default: true },
    alive: { type: Boolean, default: true },
    place: { type: Boolean, default: true },
    pts: { type: Boolean, default: true },
    elims: { type: Boolean, default: true },
  },
  { _id: false }
);

const pointsTableHeaderSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
  },
  { _id: false }
);

const OVERLAY_TEMPLATES = [
  "classic",
  "lower-third",
  "card-stack",
  "big-board",
  "hairline",
];
const SURFACE_STYLES = [
  "solid",
  "gradient",
  "glass",
  "transparent",
  "none",
];
const VERTICAL_ANCHORS = ["top", "middle", "bottom"];
const HORIZONTAL_ANCHORS = ["left", "center", "right"];
const WATERMARK_CORNERS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const overlayTypographySchema = new mongoose.Schema(
  {
    fontFamily: { type: String, default: "" },
    fontScale: { type: Number, default: 1, min: 0.5, max: 2 },
    uppercase: { type: Boolean, default: true },
    letterSpacing: { type: Number, default: 0, min: -0.1, max: 0.5 },
  },
  { _id: false }
);

const overlaySurfaceSchema = new mongoose.Schema(
  {
    style: { type: String, enum: SURFACE_STYLES, default: "transparent" },
    opacity: { type: Number, default: 0.92, min: 0, max: 1 },
    blur: { type: Number, default: 8, min: 0, max: 40 },
    radius: { type: Number, default: 12, min: 0, max: 48 },
    borderWidth: { type: Number, default: 1, min: 0, max: 8 },
    shadow: { type: Boolean, default: true },
    scanline: { type: Boolean, default: false },
    animate: { type: Boolean, default: true },
    backgroundImage: { type: String, default: "" },
    backgroundImageOpacity: { type: Number, default: 0.25, min: 0, max: 1 },
    backgroundImageBlur: { type: Number, default: 0, min: 0, max: 40 },
    gradientFrom: { type: String, default: "" },
    gradientTo: { type: String, default: "" },
    gradientAngle: { type: Number, default: 140, min: 0, max: 360 },
  },
  { _id: false }
);

const overlayPositionSchema = new mongoose.Schema(
  {
    vertical: { type: String, enum: VERTICAL_ANCHORS, default: "bottom" },
    horizontal: { type: String, enum: HORIZONTAL_ANCHORS, default: "left" },
    offsetX: { type: Number, default: 48, min: 0, max: 4000 },
    offsetY: { type: Number, default: 288, min: 0, max: 4000 },
  },
  { _id: false }
);

const overlayWatermarkSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    image: { type: String, default: "" },
    corner: { type: String, enum: WATERMARK_CORNERS, default: "top-right" },
    size: { type: Number, default: 72, min: 16, max: 320 },
    opacity: { type: Number, default: 0.85, min: 0, max: 1 },
    offset: { type: Number, default: 24, min: 0, max: 400 },
  },
  { _id: false }
);

const pointsTableLayoutSchema = new mongoose.Schema(
  {
    template: { type: String, enum: OVERLAY_TEMPLATES, default: "classic" },
    width: { type: Number, default: 300, min: 200, max: 640 },
    rowHeight: { type: Number, default: 36, min: 26, max: 60 },
    fontScale: { type: Number, default: 1, min: 0.7, max: 1.6 },
    showTrophy: { type: Boolean, default: true },
    gap: { type: Number, default: 0, min: 0, max: 24 },
  },
  { _id: false }
);

const notificationSettingsSchema = new mongoose.Schema(
  {
    template: { type: String, enum: OVERLAY_TEMPLATES, default: "classic" },
    showLogo: { type: Boolean, default: true },
    showKills: { type: Boolean, default: true },
    showRank: { type: Boolean, default: true },
    showRound: { type: Boolean, default: true },
    durationMs: { type: Number, default: 5000, min: 1000, max: 15000 },
    position: { type: overlayPositionSchema, default: () => ({}) },
  },
  { _id: false }
);

const headerLabelsSchema = new mongoose.Schema(
  {
    rank: { type: String, default: "RANK" },
    team: { type: String, default: "TEAM" },
    place: { type: String, default: "PLACE" },
    elims: { type: String, default: "ELIMS" },
    total: { type: String, default: "TOTAL" },
  },
  { _id: false }
);

const leaderboardSettingsSchema = new mongoose.Schema(
  {
    template: { type: String, enum: OVERLAY_TEMPLATES, default: "classic" },
    showTitle: { type: Boolean, default: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    bannerImage: { type: String, default: "" },
    showLogo: { type: Boolean, default: true },
    logoSize: { type: Number, default: 30, min: 16, max: 96 },
    logoRounding: { type: Number, default: 6, min: 0, max: 50 },
    showPlace: { type: Boolean, default: true },
    showElims: { type: Boolean, default: true },
    showTotal: { type: Boolean, default: true },
    showChickens: { type: Boolean, default: true },
    headerLabels: { type: headerLabelsSchema, default: () => ({}) },
    footerNote: { type: String, default: "" },
  },
  { _id: false }
);

const matchSettingsSchema = new mongoose.Schema(
  {
    template: { type: String, enum: OVERLAY_TEMPLATES, default: "classic" },
    showTitle: { type: Boolean, default: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    bannerImage: { type: String, default: "" },
    footerNote: { type: String, default: "" },
    showLogo: { type: Boolean, default: true },
    showRank: { type: Boolean, default: true },
    showElims: { type: Boolean, default: true },
    showPlace: { type: Boolean, default: true },
    showTotal: { type: Boolean, default: true },
  },
  { _id: false }
);

export const pointsTableSchema = new mongoose.Schema(
  {
    preset: { type: String, default: "esports-blue" },
    colors: { type: pointsTableColorsSchema, default: () => ({}) },
    typography: { type: overlayTypographySchema, default: () => ({}) },
    surface: { type: overlaySurfaceSchema, default: () => ({}) },
    columns: { type: pointsTableColumnsSchema, default: () => ({}) },
    header: { type: pointsTableHeaderSchema, default: () => ({}) },
    layout: { type: pointsTableLayoutSchema, default: () => ({}) },
    notifications: { type: notificationSettingsSchema, default: () => ({}) },
    leaderboard: { type: leaderboardSettingsSchema, default: () => ({}) },
    match: { type: matchSettingsSchema, default: () => ({}) },
    watermark: { type: overlayWatermarkSchema, default: () => ({}) },
  },
  { _id: false }
);

const brandingSchema = new mongoose.Schema(
  {
    systemName: { type: String, default: "PMWC", trim: true },
    logoUrl: { type: String, default: "" },
    faviconUrl: { type: String, default: "" },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "app" },
    defaultTournamentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      default: null,
    },
    branding: {
      type: brandingSchema,
      default: () => ({}),
    },
    // Legacy single-tournament design blob. Kept as a backup only; the
    // authoritative design now lives on each Tournament document.
    pointsTable: {
      type: pointsTableSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

export const Settings = mongoose.model("Settings", settingsSchema);
