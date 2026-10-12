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
    pts: { type: Boolean, default: true },
    elims: { type: Boolean, default: true },
  },
  { _id: false }
);

const pointsTableHeaderSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
  },
  { _id: false }
);

const pointsTableLayoutSchema = new mongoose.Schema(
  {
    width: { type: Number, default: 300, min: 200, max: 640 },
    rowHeight: { type: Number, default: 36, min: 26, max: 60 },
    fontScale: { type: Number, default: 1, min: 0.7, max: 1.6 },
    showTrophy: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationSettingsSchema = new mongoose.Schema(
  {
    showLogo: { type: Boolean, default: true },
    showKills: { type: Boolean, default: true },
    showRank: { type: Boolean, default: true },
    showRound: { type: Boolean, default: true },
    durationMs: { type: Number, default: 5000, min: 1000, max: 15000 },
  },
  { _id: false }
);

const leaderboardSettingsSchema = new mongoose.Schema(
  {
    showLogo: { type: Boolean, default: true },
    showPlace: { type: Boolean, default: true },
    showElims: { type: Boolean, default: true },
    showTotal: { type: Boolean, default: true },
    showChickens: { type: Boolean, default: true },
  },
  { _id: false }
);

const matchSettingsSchema = new mongoose.Schema(
  {
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
    columns: { type: pointsTableColumnsSchema, default: () => ({}) },
    header: { type: pointsTableHeaderSchema, default: () => ({}) },
    layout: { type: pointsTableLayoutSchema, default: () => ({}) },
    notifications: { type: notificationSettingsSchema, default: () => ({}) },
    leaderboard: { type: leaderboardSettingsSchema, default: () => ({}) },
    match: { type: matchSettingsSchema, default: () => ({}) },
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
