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
  },
  { _id: false }
);

const pointsTableColumnsSchema = new mongoose.Schema(
  {
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

const pointsTableSchema = new mongoose.Schema(
  {
    preset: { type: String, default: "esports-blue" },
    colors: { type: pointsTableColorsSchema, default: () => ({}) },
    columns: { type: pointsTableColumnsSchema, default: () => ({}) },
    header: { type: pointsTableHeaderSchema, default: () => ({}) },
    layout: { type: pointsTableLayoutSchema, default: () => ({}) },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "app" },
    pointsTable: {
      type: pointsTableSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

export const Settings = mongoose.model("Settings", settingsSchema);
