import { CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";

/**
 * How each announcement tone looks.
 *
 * One table, used by the banner AND by the admin tone picker, so the swatch an admin chooses
 * is by construction the colour and icon members will see. When these lived in two places the
 * picker was a blue outline regardless of the tone, which meant choosing "urgent" gave no
 * indication of what urgent actually looks like.
 */
export type ToneStyle = {
  /** Shown in the admin picker. "destructive" is jargon; "urgent" is what it means. */
  label: string;
  icon: LucideIcon;
  /** The banner's frame. */
  wrap: string;
  /** The icon itself, in both the banner and the picker. */
  icon_: string;
  /** The picker button when this tone is chosen. */
  selected: string;
};

export const TONES: Record<string, ToneStyle> = {
  info: {
    label: "Info",
    icon: Info,
    wrap: "border-info/30 bg-info/5",
    icon_: "text-info",
    selected: "border-info bg-info/10 text-foreground",
  },
  success: {
    label: "Success",
    icon: CircleCheck,
    wrap: "border-success/30 bg-success/5",
    icon_: "text-success",
    selected: "border-success bg-success/10 text-foreground",
  },
  warning: {
    label: "Warning",
    icon: TriangleAlert,
    wrap: "border-warning/30 bg-warning/5",
    icon_: "text-warning",
    selected: "border-warning bg-warning/10 text-foreground",
  },
  destructive: {
    label: "Urgent",
    icon: TriangleAlert,
    wrap: "border-destructive/30 bg-destructive/5",
    icon_: "text-destructive",
    selected: "border-destructive bg-destructive/10 text-foreground",
  },
};

export const toneOf = (severity: string): ToneStyle => TONES[severity] ?? TONES.info;
