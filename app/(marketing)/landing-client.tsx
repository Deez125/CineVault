"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { logoutAction } from "@/lib/auth/actions";
import { displayName, initial, type Nameable } from "@/lib/display-name";

/**
 * The public landing page.
 *
 * Ported one-to-one from the design template (see `new landing page/CineVaultLanding.jsx`)
 * with the placeholder external URLs swapped for real in-app routes and any imports
 * adapted to Next. CSS is inline for now: everything is prefixed with `cv-` so it does not
 * collide with the tailwind classes elsewhere, and keeping it colocated makes it easy to
 * move to a `landing.module.css` later without unpicking the design.
 *
 * Client component top-to-bottom: the whole page reads scroll, opens a mobile menu,
 * observes intersections for reveals, animates count-ups. Trying to split off a server
 * shell would save one hydration round-trip at the cost of splintering this into three
 * files that only ever change together.
 *
 * The fonts (Anton, Barlow, IBM Plex Mono) are pulled from Google Fonts via a CSS `@import`,
 * loaded by the browser at request time. This is deliberately NOT `next/font/google` — that
 * variant fetches the fonts during build/compile and stalled on this project earlier. A
 * plain client fetch works, and the fonts are only needed on the marketing page.
 */

const NAV = [
  { label: "The vault", href: "#vault" },
  { label: "Inside", href: "#inside" },
  { label: "How it works", href: "#how" },
  { label: "Plans", href: "#plans" },
];

const STATS = [
  { value: 100000, suffix: "+", label: "Titles", note: "Movies and full TV runs" },
  { value: 1, from: 9, suffix: "", label: "Subscription", note: "In place of eight of them" },
  { value: 99.9, suffix: "%", label: "Uptime", note: "Rolling 90 days", decimals: 1 },
  { value: 0, from: 500, suffix: "", label: "Ads", note: "Now and forever" },
];

const INSIDE = [
  {
    title: "Nothing rotates out",
    body: "No licensing deal expires here. What you added to your list last year is still sitting there tonight.",
    tag: "Library",
  },
  {
    title: "No ads, ever",
    body: "Not before the film, not in the middle of it, and not as a paid tier you have to upgrade to avoid.",
    tag: "No ads",
  },
  {
    title: "Every device you own",
    body: "Phone, tablet, smart TV, Apple TV, Roku, Xbox, browser. Pause on one, pick it up on the next.",
    tag: "Devices",
  },
  {
    title: "Picks up where you left off",
    body: "Start an episode on your phone, finish it on the TV. Your progress follows you across every device you sign in on.",
    tag: "Sync",
  },
  {
    title: "Download for offline",
    body: "Pull titles onto your device before a flight and watch them with the plane in airplane mode.",
    tag: "Offline",
  },
  {
    title: "Subtitles that work",
    body: "Multiple languages on nearly everything, forced subtitles handled properly, and no fighting the player.",
    tag: "Access",
  },
];

const STEPS = [
  {
    title: "Pick your streams",
    body: "Choose how many things can play at once. That's the only difference between plans — every plan gets the entire library.",
  },
  {
    title: "Create your account",
    body: "Sign up, pay, and you're in. Access goes live the moment the payment clears — no waiting on approval.",
  },
  {
    title: "Open Plex",
    body: "Sign in on the app you already have. The full library shows up on every device on your account.",
  },
];

/**
 * The four plans, matched to what's in lib/plans.ts / Stripe. The href goes to /signup with
 * a `?plan=N` marker — the signup form doesn't consume it yet, but landing → sign up →
 * billing needs to remember which tier the visitor was interested in, and the URL is the
 * only survivable place for that across an OAuth or email-confirmation hop. When the
 * billing page grows a preselect for `?plan=`, this stops being cosmetic.
 */
const TIERS = [
  {
    streams: 1,
    price: 20,
    blurb: "For one person. One thing playing at a time.",
    href: "/signup?plan=1",
  },
  {
    streams: 2,
    price: 30,
    blurb: "For a couple, or a small household.",
    href: "/signup?plan=2",
    popular: true,
  },
  {
    streams: 3,
    price: 40,
    blurb: "For a household that watches separately.",
    href: "/signup?plan=3",
  },
  {
    streams: 4,
    price: 50,
    blurb: "For a full house, or a few friends.",
    href: "/signup?plan=4",
  },
];

/**
 * Ad-free tier prices, US, verified August 2026. Re-check before launch — they move.
 */
const RIVALS = [
  { name: "Netflix Premium", price: 26.99 },
  { name: "Max Premium", price: 22.99 },
  { name: "Disney+ (no ads)", price: 18.99 },
  { name: "Hulu (no ads)", price: 18.99 },
  { name: "Prime Video (ad-free)", price: 17.98 },
  { name: "Peacock Premium Plus", price: 16.99 },
  { name: "Paramount+ Premium", price: 13.99 },
  { name: "Apple TV+", price: 9.99 },
];

const RIVAL_TOTAL = RIVALS.reduce((a, b) => a + b.price, 0);
const CV_PRICE = 20;
const YEARLY_SAVED = (RIVAL_TOTAL - CV_PRICE) * 12;

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const FAQ = [
  {
    q: "What do I need to watch?",
    a: "A free Plex account and the Plex app — phone, tablet, smart TV, Apple TV, Roku, Xbox, or just a browser. Nothing else to install.",
  },
  {
    q: "What does a concurrent stream mean?",
    a: "One thing playing at a time. On the 2-stream plan, you and someone else can watch different titles at once. Pick the number that matches how many screens run in your house on a busy night.",
  },
  {
    q: "How many devices can I sign in on?",
    a: "As many as you like — phone, laptop, the TV in the living room, all at once. Your plan limits how many can be playing at the same time, not how many are signed in.",
  },
  {
    q: "Does it work on my TV?",
    a: "Yes — Plex runs on nearly every smart TV, plus Apple TV, Roku, Fire Stick, Chromecast and consoles. Quality scales to whatever your TV and connection can handle.",
  },
  {
    q: "Is there a contract?",
    a: "No. Monthly, cancel any time from your dashboard. Access runs through the end of the period you already paid for.",
  },
];

/* ---------------------------- motion helpers ---------------------------- */

function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setSeen(true);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px", ...(options || {}) }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [options]);

  return [ref, seen] as const;
}

function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
  ...rest
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
} & React.HTMLAttributes<HTMLElement>) {
  const [ref, seen] = useInView();
  const Component = Tag as unknown as React.ComponentType<
    React.HTMLAttributes<HTMLElement> & { ref?: React.Ref<HTMLElement> }
  >;
  return (
    <Component
      ref={ref}
      className={`cv-reveal ${seen ? "cv-in" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Component>
  );
}

function CountUp({
  value,
  from = 0,
  decimals = 0,
  suffix = "",
}: {
  value: number;
  from?: number;
  decimals?: number;
  suffix?: string;
}) {
  const [ref, seen] = useInView({ threshold: 0.4 });
  const [n, setN] = useState(from);

  useEffect(() => {
    if (!seen) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || from === value) {
      setN(value);
      return;
    }
    const dur = 1300;
    const start = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 4);
      setN(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, from]);

  const shown =
    decimals > 0
      ? n.toFixed(decimals)
      : Math.round(n).toLocaleString("en-US");

  return (
    <span ref={ref as React.Ref<HTMLSpanElement>} className="cv-stat-value">
      {shown}
      <span className="cv-stat-suffix">{suffix}</span>
    </span>
  );
}

/* ------------------------------- logo ------------------------------- */

function Logo() {
  return (
    <svg
      className="cv-logo"
      viewBox="0 0 1530.42 378.29"
      role="img"
      aria-label="CineVault"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M350.73,142.65h-37.5l-2.34,2.66-43.16,75.84c-10.1,9.77-34.07,32.45-48.53,31.59-9.49-.56-7.32-9.77-4.95-16.07,11.34-30.16,40.37-61.14,52.71-90.3.54-1.26,1.04-2.26.78-3.72h-38.5c-7.1,9.24-13.17,19.66-19.31,29.69-10.54,17.23-37.71,58.58-39.17,76.82-2.65,33.06,29.41,35.35,52.36,23.36l26.62-16.87c.7.67-9.06,14.73-9.57,16.95-.25,1.1.71,2.04,1.07,2.04h38c21.15-34.87,35.49-75.29,69.02-100.98,5.84-4.47,22.36-15.95,28.93-8.97,6,6.38-.82,16.23-4.28,22.62-10.96,20.25-53.33,71.06-19.21,87.87,27.72,13.65,61.51-12.6,82.52-28.56,9.66,28.94,40.59,36,67.89,32.9,33.26-3.78,67.99-23.38,92.64-45.36,3.49-3.12,22.11-21.15,23.24-23.79,2.2-5.09-5.82-9.75-9.97-7.99-3.26,1.39-10.33,10.27-13.81,13.24-23.72,20.21-64.5,47.71-97.02,38.07-13.07-3.87-25.06-15.38-20.35-29.94,31.45-.02,91.92-14.79,102.93-48.57,12.06-37-31.9-40.45-57.24-36.24-35.89,5.95-77.95,38.91-87.08,74.92-.92,3.63-1.6,13.74-3.02,15.5-1.23,1.53-8.63,7.08-10.79,8.7-7.46,5.58-38.51,27.18-39.88,6.97-.84-12.32,31.05-53.23,37.15-68.7,5.08-12.91,4.95-27.81-9.49-33.87-21.56-9.05-51.08,4.35-68.68,17.19-1.48-1.9,8.78-13.55,7.99-17ZM536.47,154.89c3.99-.64,10.83-.77,13.95,2.08,10.42,9.53-9.46,28.51-16.77,34.1-13.88,10.61-33.25,18.96-50.91,18.58,8.56-18.59,32.49-51.34,53.73-54.75Z" />
      <path d="M792.75,123.17c12.08-37.61,17.25-76.2-24.64-96.4-54.89-26.47-134.58,8.19-164.79,57.96-15.6,25.71-18.72,61.24,9.11,79.73,17.87,11.87,53.82,15.7,63.3-7.8-17.91,4.23-34.84-2.26-39.53-20.97-11.29-45.08,56.15-108.04,100.33-94.33,39.3,12.2,7.81,75.75-2.62,99.97-21.44,49.79-47.7,97.52-70.15,146.85.2,1.99,1.6,3.08,3.5,3.45,4.48.86,16.84.32,22.01.07,13.8-.66,27.78-3.39,41.38-5.62,38.75-30.21,76.97-61.54,112.6-95.4,59.26-56.3,108.07-122.56,163.52-182.47,3.2-5.5-.67-7.06-5.55-7.55-17.07-1.74-52.92.07-69.36,4.63-1.91.53-3.81,1.1-5.38,2.35-1.05.84-7.77,10.83-7.73,11.53.21,3.95,21.21-3.5,17.52,10.51-1.63,6.2-12.54,20.27-16.73,26.3-44.41,63.86-101.26,124.26-160.8,174.2-4.12,3.45-16.78,14.75-20.53,16.48-.53.24-1.7.19-1.48-.49,19.9-39.98,42.3-80.3,56.01-122.99Z" />
      <path d="M1522.12,220.76c-26.37-27.14-65.52,9.75-88.72,23.06-12.89,7.4-43.42,24.81-39.41-4.41,1.73-12.59,19.13-38.78,26.32-50.67,8.5-14.06,17.79-27.63,26.36-41.64l3.51-1.49,51.88-.12,13.91-20.09.75-4.74c-.72-.76-15.02,4.7-17.49,5-11.9,1.41-26.32-1.05-38.5,0l23-36.99c-14.23-2.03-28.91-.75-43.31-.82l-2.16,1.84-22.54,35.46c-3.41,2.05-14.56-.98-18.98,1.02-4.42,2.01-11.95,15.59-16.02,19.48h22c-8.79,13.97-18.04,27.7-26.81,41.69-5.36,8.54-10.18,19.11-15.77,27.23-7.44,10.81-38.51,32.07-51.16,36.84-11.26,4.25-28.92,6.97-29.05-10.26-.03-4.69,5.57-24.92,8.35-28.45,1.52-1.93,15.29-9.76,18.76-12.24,32.97-23.58,81.75-69.35,98.54-106.46,13.84-30.61-4.51-47.41-35.12-36.12-50.12,18.5-105.22,107.41-125.92,155.08-1.31,3.03-4.46,14.48-5.5,15.75-3.34,4.07-27.69,19.04-33.33,21.41-17.2,7.2-26.15,2.01-17.53-16.53,8.4-18.05,24.18-40.56,35.13-57.87,7.59-12,15.48-23.82,23.4-35.6.26-2.03-.08-1.3-1.47-1.48-8.55-1.14-28.02-.67-37.06-.04-2.93.2-5.72,1.3-8.72,1.05l-50.74,83.49c-7.64,9.7-33.95,30.96-46.42,30.43-6.4-.27-9.89-4.9-9.37-11.14.83-10.02,27.52-51.44,34.38-62.7,8.03-13.19,16.3-26.28,24.98-39.05.89-.61-.94-2.03-1.06-2.03h-41c-4.56,0-6.75,4.85-8.92,8.08-16.6,24.77-30.5,53.37-46.05,78.95-10.63,7.78-33.92,28.06-47.04,28.05-10.72,0-9.46-11.22-6.37-18.46,13.05-30.56,41.93-63.23,57.67-93.33.58-1.12,1.56-1.75,1.21-3.29h-44.5c-3.24,4.13-6.85,9.08-8.51,14-6.95-6.37-11.07-11.46-20.79-13.7-46.86-10.81-105.21,31.02-124.06,72.35-23.77,52.09,12.33,84.45,63.21,61.21,11.31-5.17,21.09-13.09,30.63-20.86-1.67,27.08,18.37,32.43,41,26.49,19.04-5,35.15-17.19,50.01-29.49v14.5c0,4.87,8.03,11.76,12.31,13.69,18.17,8.19,43.55-1.12,59.61-10.77l22.08-15.41c-4.13,14.06,4.39,26.52,18.74,28.75,28.4,4.42,53.92-15.02,75.25-30.76,1.82,47.03,61.16,32.07,86.93,14.42l24.08-16.41c-3.62,48.58,53.1,34.13,80.02,19.51,17.21-9.34,50.44-40.07,67.58-40.41,15.39-.31,20.52,14.14,14.9,26.89-15.46,35.1-97.64,56.22-132.32,62.68-128.5,23.95-269.88,16.2-399.7,9.32-56.41-2.99-113.85-9.1-169.95-11.05-58.56-2.03-116.54,8.68-175.08,6.08-14.46-.64-29.41-2.65-43.83-4.17-93.24-9.77-182.57-25.47-275.24-24.38v23.69c92.5-1.6,182.11,12.14,275.24,22.69,214.88,24.33,428.96,53.16,645.87,35.12,75.44-6.28,203.49-23.87,261.52-74.48,18.57-16.2,49.63-53.46,26.38-77.4ZM1334.31,131.73c8.26-12.56,38.11-56.88,51.98-59.02,18.12-2.79-.42,23.1-4.54,29.45-17.3,26.61-48.77,59.5-73.55,79.45-.97.78-5.72,4.72-6.47,4.02,10.68-18.05,21.05-36.37,32.58-53.91ZM989.9,179.32c-6.61,13.39-17.46,31.75-25.75,44.25-7.42,11.2-30.39,30.57-44.03,32.02-7.87.84-15.71-4.83-17.16-12.68-5.82-31.53,40.51-85.81,71.57-88.03,6.52-.47,14.82,2.54,17.69,8.76,3.03,6.57.53,9.89-2.33,15.68ZM709.11,331.58l-20.39-1.94c-.03-1.8-.47-4.19,1.65-4.85,5.66-1.76,15.18-.69,21.35-2.14-.04,2.09-.63,8.33-2.61,8.93ZM752.25,334.67c-1.8,2.42-18.43-1.84-22.53-1.02l2-12c5.47,1.04,16.89-1.41,21.5,0,2.65.81.04,11.66-.98,13.02ZM797.73,340.21c-1.57.78-19.55-2.2-22.91-2.65-.58-.84,3.18-14.99,3.85-15.46,2.09-1.46,19.12,1.51,23.01,1.6.16,3.27-1.23,15.17-3.95,16.52ZM847.72,345.2c-2.24,1.06-19.93-2.77-23.97-2.57-.68-.7,2.19-16.43,3.97-17.53,3.02.04,23.24,1.65,23.93,2.64-.76,3.5-1.36,16.24-3.93,17.46ZM897.78,350.13c-.95.41-17.87-1.11-20.61-1.43-1.07-.12-2.3.03-3.01-.99-.75-3.25-.1-16.28,2.55-17.57,2.07-1,23.23.62,23.86,1.65.24,3.36-.11,17.18-2.8,18.34ZM950.29,352.71c-1.14,1.69-23.12.55-24.62-.5-1.46-1.02-1.04-5.21-.92-7.05.15-2.35.93-10.81,2.63-11.37,2.18-.72,21.95.29,23.43,1.29,1.82,1.24.67,15.88-.51,17.63ZM1004.73,355.15c0,.11-1.39,1.5-1.5,1.5-5.87,0-14.61.79-20,0-9.84-1.45-4.21-12.54-3.57-19.56l22.57.56c.82-.03,2.5.94,2.5,1.5v16ZM1058.73,358.15c0,1.1-2.45,1.43-3.45,1.55-6.72.82-16.25-2.5-23.55-1.05v-17.5c0-.11,1.39-1.5,1.5-1.5h23c.33,0,1.52,1.32,2.5,1v17.5ZM1112.73,359.15c0,.11-1.39,1.5-1.5,1.5h-23c-.18,0-2.5-2.32-2.5-2.5v-15c0-.27,1.17-.99,1.5-1.5h24c.11,0,1.5,1.39,1.5,1.5v16ZM1168.27,358.69c-2.12,3.22-21.26,1.91-25.6,1.53-.94-2.74-3.7-18.56.56-18.56h23c1.93,0,3.54,14.75,2.04,17.04ZM1220.29,357.72c-.76,1.08-21.51,2.12-24.63,1.5-1.37-.98-2.7-15.97-1.79-17.43,1.23-1.97,21.29-1.19,24.92-.71,1.09.76,1.95,14.24,1.5,16.63ZM1270.74,354.17c-1.46,1.11-21.55,3.16-22.87,2.34-.78-2.88-3.24-16.04-1.21-17.42,2.03-1.38,22.4-2.27,23.63-.5.62.9,1.89,14.49.45,15.59ZM1302.07,351.61c-5.55.25-6.05-15.18-4.36-16.48,1.93-1.47,21.86-4,22.88-2.34l1.07,15.8c-6.25.21-13.57,2.74-19.59,3.01ZM1368.67,339.6c-4.1-.59-17.79,4.6-20.37,3.94-1.39-.36-3.83-13.14-3.5-14.27.57-1.9,19.78-5.78,22-4.18,1.14.82,2.58,13.77,1.87,14.51ZM1411.31,328.7c-.77,1.15-18.6,5.85-19.56,4.93l-1.95-12.9,18.89-4.05c-.26,2.19,3.24,11.1,2.62,12.02ZM1448.58,314.96c-.55,2.26-13.46,7.15-15.23,6.62-1.83-.55-4.49-10.29-3.5-11.81.44-.68,14.51-5.23,15.29-5.04,1.51.38,3.79,8.75,3.44,10.23ZM1479.65,300.52c-.4.56-11.14,6.38-12.27,6.05-1.44-.43-5-7.8-4.57-9.26.35-1.21,11.44-6.78,12.32-6.58,1.56.36,5.05,9.04,4.52,9.79ZM1502.61,281.96c-.47,1.85-7.15,5.23-8.38,7.67-1.8-1.53-4.97-6.01-4.38-8.29.29-1.11,7.46-6.49,8.55-6.59,2.05-.19,4.66,5.48,4.22,7.2ZM1515.23,268.63c-6.32-4.62-5.23-7.94,0-12.97.49,1.46,4.16,2.81,4.36,3.14.93,1.59-3.6,9.82-4.36,9.82Z" />
      <path d="M129.95,295.29s102.47-11.39,234.68-3.15l-1.87,23.22s-69.44-5.35-192.18,13.58l-40.64-33.64Z" />
      <path d="M269.44,9.94C188.68-9.64,86.36,52.51,40.42,116.33c-67.79,94.19-57.13,224.31,84.36,217.36,30.45-1.5,62.54-7.21,94.67-13l-7.18-22.15c-7.61,1.42-15.23,2.82-22.85,4.17l-2.51,3.21-7.73-1.44c-.32.05-.63.11-.95.16.1-.09.2-.19.31-.28l-48.59-9.07h0c-9.75.94-19.76.17-29.94-2.92-26.16-7.93-44.18-32.38-46.65-59.35-7.9-86.08,79.2-183.91,161.67-199.08,18.53-3.41,49.26-4.65,63.6,9.81,29.81,30.07-30.31,72.01-62.87,46.87-5.75-4.44-7.86-13.49-8.54-13.97-3.95-2.71-8.31,9.89-8.72,12.75-4.91,33.92,30.22,45.46,57.95,40.95,67.65-11,89.76-101.8,13-120.41Z" />
    </svg>
  );
}

/* ------------------------------- user chip ------------------------------- */

type LandingUser = Nameable & { avatarUrl: string | null };

/**
 * The account chip in the top-right of the nav, shown to signed-in visitors instead of the
 * Sign in / Get started buttons.
 *
 * Custom dropdown rather than shadcn's — the shadcn menu renders inside a portal and
 * inherits the app's default theme, which fights the landing's dark shell. A small hand-
 * rolled menu keeps the styling under the same `cv-` roof as the rest of the page.
 */
function UserChip({ user }: { user: LandingUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = displayName(user);

  // Close on outside click and Escape. The dropdown is not a modal — nothing in the layer
  // beneath is disabled — so a click there should dismiss without also doing whatever it
  // was going to do (hence a mousedown listener rather than click, so the underlying
  // click still lands).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="cv-user" ref={ref}>
      <button
        type="button"
        className="cv-user-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="cv-user-avatar">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" />
          ) : (
            <span aria-hidden>{initial(user)}</span>
          )}
        </span>
        <span className="cv-user-name">{name}</span>
        <svg
          className={`cv-user-chev ${open ? "cv-user-chev-open" : ""}`}
          viewBox="0 0 12 12"
          aria-hidden
        >
          <path d="M2.5 4.5 L6 8 L9.5 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div role="menu" className="cv-user-menu">
          <div className="cv-user-meta">
            <p className="cv-user-meta-name">{name}</p>
            <p className="cv-user-meta-email">{user.email}</p>
          </div>

          <Link href="/dashboard" onClick={() => setOpen(false)} className="cv-user-item">
            Dashboard
          </Link>
          <Link href="/dashboard/settings" onClick={() => setOpen(false)} className="cv-user-item">
            Settings
          </Link>

          {/* Sign-out is a POST because it changes server state — a GET link would let any
              page on the internet log the visitor out with an <img src>. */}
          <form action={logoutAction} className="cv-user-form">
            <button type="submit" className="cv-user-item cv-user-item-danger">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- page -------------------------------- */

export function LandingClient({ user }: { user: LandingUser | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoverTier, setHoverTier] = useState(1);
  const [openFaq, setOpenFaq] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const jump = useCallback((e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const el = document.querySelector(href);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setMenuOpen(false);
  }, []);

  return (
    <div className="cv-root">
      <style>{CSS}</style>

      <div className="cv-grain" aria-hidden="true" />

      {/* ---------------- nav ---------------- */}
      <header className={`cv-nav ${scrolled ? "cv-nav-solid" : ""}`}>
        <div className="cv-nav-inner">
          <Link className="cv-brand" href="/">
            <Logo />
          </Link>

          <nav className="cv-nav-links" aria-label="Sections">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} onClick={(e) => jump(e, l.href)}>
                {l.label}
              </a>
            ))}
          </nav>

          <div className="cv-nav-actions">
            {user ? (
              <UserChip user={user} />
            ) : (
              <>
                {/* Outlined rather than ghost — a bare text link next to a solid CTA reads
                    as secondary noise; the outline gives Sign in enough presence to be
                    found by somebody who came here to log in and not to sign up. Hidden on
                    mobile (see .cv-nav-signin rule) because the burger drawer carries it. */}
                <Link className="cv-btn cv-btn-line cv-nav-signin" href="/login">
                  Sign in
                </Link>
                <Link className="cv-btn cv-btn-solid" href="/signup">
                  Get started
                </Link>
              </>
            )}
            <button
              className="cv-burger"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span />
              <span />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="cv-mobile-menu">
            {NAV.map((l) => (
              <a key={l.href} href={l.href} onClick={(e) => jump(e, l.href)}>
                {l.label}
              </a>
            ))}
            {user ? (
              <>
                <Link href="/dashboard" onClick={() => setMenuOpen(false)}>
                  Dashboard
                </Link>
                <Link href="/dashboard/settings" onClick={() => setMenuOpen(false)}>
                  Settings
                </Link>
                <form action={logoutAction}>
                  <button type="submit" className="cv-mobile-signout">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link href="/login" onClick={() => setMenuOpen(false)}>
                Sign in
              </Link>
            )}
          </div>
        )}
      </header>

      <main>
        {/* ---------------- hero ---------------- */}
        <section className="cv-hero">
          <div className="cv-hero-inner">
            <h1 className="cv-hero-title">
              <span className="cv-line">
                <span className="cv-word cv-w1">The ultimate</span>
              </span>
              <span className="cv-line">
                <span className="cv-word cv-w2">streaming</span>
              </span>
              <span className="cv-line">
                <span className="cv-word cv-w3">service.</span>
              </span>
            </h1>

            <p className="cv-hero-sub cv-w4">
              Over 100,000 movies and shows in one library. Nothing rotates out, nothing
              is region-locked, and nothing stops to play an ad. Stream it on every device
              you already own for $20 a month, and cancel any time.
            </p>

            <div className="cv-hero-cta cv-w5">
              <Link className="cv-btn cv-btn-solid cv-btn-lg" href="/signup">
                Get started
              </Link>
              <a className="cv-btn cv-btn-line cv-btn-lg" href="#plans" onClick={(e) => jump(e, "#plans")}>
                See the plans
              </a>
            </div>

            <p className="cv-hero-foot cv-w6 cv-mono cv-dim">
              One bill instead of eight — ${money(RIVAL_TOTAL)}/month of streaming for $20
            </p>
          </div>
        </section>

        {/* ---------------- thesis ---------------- */}
        <section className="cv-section" id="vault">
          <div className="cv-wrap">
            <Reveal className="cv-thesis">
              <p className="cv-eyebrow">The vault</p>
              <h2 className="cv-thesis-text">
                Streaming split into eight bills, catalogs shrank, and the film you
                wanted moved to a service you don&apos;t have.{" "}
                <span className="cv-accent">CineVault puts it back together</span> — over
                100,000 movies and shows, one login, one price, and nothing disappearing
                at the end of a licensing deal.
              </h2>
            </Reveal>

            <div className="cv-stats">
              {STATS.map((s, i) => (
                <Reveal className="cv-stat" key={s.label} delay={i * 90}>
                  <CountUp value={s.value} from={s.from} decimals={s.decimals} suffix={s.suffix} />
                  <p className="cv-stat-label">{s.label}</p>
                  <p className="cv-mono cv-dim">{s.note}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- the math ---------------- */}
        <section className="cv-section">
          <div className="cv-wrap">
            <Reveal className="cv-head">
              <p className="cv-eyebrow">The math</p>
              <h2 className="cv-h2">
                One subscription beats
                <br />
                all of them combined
              </h2>
              <p className="cv-lede">
                Here&apos;s the bill if you subscribe to every major service at its
                ad-free tier. Then here&apos;s ours.
              </p>
            </Reveal>

            <div className="cv-ledger">
              {RIVALS.map((r, i) => (
                <Reveal className="cv-ledger-row" key={r.name} delay={i * 55}>
                  <p className="cv-ledger-name">{r.name}</p>
                  <div className="cv-ledger-track">
                    <span
                      className="cv-ledger-fill"
                      style={{ ["--w" as string]: `${(r.price / RIVAL_TOTAL) * 100 * 3.2}%` }}
                    />
                  </div>
                  <p className="cv-ledger-price cv-mono">${money(r.price)}</p>
                </Reveal>
              ))}

              <Reveal className="cv-ledger-row cv-ledger-total">
                <p className="cv-ledger-name">All of it, every month</p>
                <div className="cv-ledger-track">
                  <span className="cv-ledger-fill" style={{ ["--w" as string]: "100%" }} />
                </div>
                <p className="cv-ledger-price cv-mono">${money(RIVAL_TOTAL)}</p>
              </Reveal>

              <Reveal className="cv-ledger-row cv-ledger-mine">
                <p className="cv-ledger-name">CineVault</p>
                <div className="cv-ledger-track">
                  <span
                    className="cv-ledger-fill"
                    style={{ ["--w" as string]: `${(CV_PRICE / RIVAL_TOTAL) * 100}%` }}
                  />
                </div>
                <p className="cv-ledger-price cv-mono">$20.00</p>
              </Reveal>
            </div>

            <Reveal className="cv-savings" delay={120}>
              <p className="cv-mono cv-dim">You keep</p>
              <p className="cv-savings-figure">
                <span className="cv-currency">$</span>
                <CountUp value={YEARLY_SAVED} decimals={0} suffix="" />
              </p>
              <p className="cv-savings-note">
                every year, against ${money(RIVAL_TOTAL)}/month for the same shelf of
                content spread across eight apps.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------- what's inside ---------------- */}
        <section className="cv-section" id="inside">
          <div className="cv-wrap">
            <Reveal className="cv-head">
              <p className="cv-eyebrow">What you get</p>
              <h2 className="cv-h2">Built the way it should have been</h2>
              <p className="cv-lede">
                Every feature the big services charge extra for, included at every tier.
              </p>
            </Reveal>

            <div className="cv-cards">
              {INSIDE.map((c, i) => (
                <Reveal className="cv-card" key={c.title} delay={(i % 3) * 90}>
                  <p className="cv-mono cv-card-tag">{c.tag}</p>
                  <h3 className="cv-card-title">{c.title}</h3>
                  <p className="cv-card-body">{c.body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- how it works ---------------- */}
        <section className="cv-section" id="how">
          <div className="cv-wrap">
            <Reveal className="cv-head">
              <p className="cv-eyebrow">How it works</p>
              <h2 className="cv-h2">Three steps, about five minutes</h2>
            </Reveal>

            <ol className="cv-steps">
              {STEPS.map((s, i) => (
                <Reveal as="li" className="cv-step" key={s.title} delay={i * 120}>
                  <span className="cv-step-num cv-mono">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3 className="cv-step-title">{s.title}</h3>
                    <p className="cv-step-body">{s.body}</p>
                  </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------- pricing ---------------- */}
        <section className="cv-section" id="plans">
          <div className="cv-wrap">
            <Reveal className="cv-head">
              <p className="cv-eyebrow">Plans</p>
              <h2 className="cv-h2">Pay for streams, not for tiers</h2>
              <p className="cv-lede">
                Every plan gets all 100,000+ titles in full quality. The only question
                is how many screens are lit at once.
              </p>
            </Reveal>

            <div className="cv-tiers">
              {TIERS.map((t, i) => (
                <Reveal
                  className={`cv-tier ${t.popular ? "cv-tier-pop" : ""} ${
                    hoverTier === t.streams ? "cv-tier-active" : ""
                  }`}
                  key={t.streams}
                  delay={i * 90}
                  onMouseEnter={() => setHoverTier(t.streams)}
                  onFocus={() => setHoverTier(t.streams)}
                >
                  {t.popular && <span className="cv-pop-flag cv-mono">Most popular</span>}

                  <h3 className="cv-tier-name">
                    <span className="cv-tier-count">{t.streams}</span>
                    <span className="cv-tier-count-label">
                      concurrent {t.streams === 1 ? "stream" : "streams"}
                    </span>
                  </h3>

                  <p className="cv-tier-price">
                    <span className="cv-currency">$</span>
                    {t.price}
                    <span className="cv-per">/month</span>
                  </p>

                  <p className="cv-tier-blurb">{t.blurb}</p>

                  <ul className="cv-tier-list">
                    <li>
                      {t.streams} concurrent {t.streams === 1 ? "stream" : "streams"}
                    </li>
                    <li>All 100,000+ titles</li>
                    <li>Every device you own</li>
                    <li>Cancel any time</li>
                  </ul>

                  <Link
                    className={`cv-btn ${t.popular ? "cv-btn-solid" : "cv-btn-line"} cv-tier-btn`}
                    href={t.href}
                  >
                    Choose
                  </Link>
                </Reveal>
              ))}
            </div>

            <Reveal className="cv-note">
              <p>
                After subscribing, connect your Plex account in{" "}
                <Link href="/dashboard/plex">Account Settings</Link> and the library
                appears on every device you&apos;re signed in on.
              </p>
            </Reveal>
          </div>
        </section>

        {/* ---------------- faq ---------------- */}
        <section className="cv-section">
          <div className="cv-wrap cv-wrap-narrow">
            <Reveal className="cv-head">
              <p className="cv-eyebrow">Questions</p>
              <h2 className="cv-h2">Before you sign up</h2>
            </Reveal>

            <div className="cv-faq">
              {FAQ.map((f, i) => (
                <Reveal
                  className={`cv-faq-item ${openFaq === i ? "cv-faq-open" : ""}`}
                  key={f.q}
                  delay={i * 60}
                >
                  <button
                    className="cv-faq-q"
                    aria-expanded={openFaq === i}
                    onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                  >
                    <span>{f.q}</span>
                    <span className="cv-faq-icon" aria-hidden="true" />
                  </button>
                  <div className="cv-faq-a">
                    <p>{f.a}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- closing cta ---------------- */}
        <section className="cv-cta">
          <Reveal className="cv-cta-inner">
            <h2 className="cv-cta-title">Ready when you are.</h2>
            <p className="cv-cta-sub cv-mono cv-dim">Plans from ${CV_PRICE}/mo</p>
            <div className="cv-hero-cta">
              <Link className="cv-btn cv-btn-solid cv-btn-lg" href="/signup">
                Get started
              </Link>
              <Link className="cv-btn cv-btn-line cv-btn-lg" href="/login">
                Sign in
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ---------------- footer ---------------- */}
      <footer className="cv-footer">
        <div className="cv-wrap cv-footer-inner">
          <span className="cv-mono cv-dim">© {new Date().getFullYear()} CineVault</span>
          <nav className="cv-footer-links">
            <Link href="/help">Help</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------ styles ------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

.cv-root {
  --ink: #06070B;
  --ink-2: #0A0B10;
  --surface: #101218;
  --line: rgba(236,240,248,0.10);
  --line-2: rgba(236,240,248,0.20);
  --azure: #4D7CFE;
  --azure-hi: #93B4FF;
  --paper: #ECF0F8;
  --dim: #7C8496;
  --display: 'Anton', 'Arial Narrow', Impact, sans-serif;
  --body: 'Barlow', system-ui, -apple-system, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;

  position: relative;
  background: var(--ink);
  color: var(--paper);
  font-family: var(--body);
  font-size: 16px;
  line-height: 1.6;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
}
.cv-root *, .cv-root *::before, .cv-root *::after { box-sizing: border-box; }
:where(.cv-root) :where(a) { color: inherit; text-decoration: none; }
:where(.cv-root) :where(p, h1, h2, h3, ul, ol) { margin: 0; }
:where(.cv-root) :where(ul, ol) { list-style: none; padding: 0; }
:where(.cv-root) :where(button) { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
.cv-root :focus-visible { outline: 2px solid var(--azure-hi); outline-offset: 3px; }

.cv-grain {
  position: fixed; inset: 0; z-index: 60; pointer-events: none; opacity: .16;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  animation: cv-grain-shift 640ms steps(2) infinite;
}
@keyframes cv-grain-shift {
  0% { transform: translate(0,0); }
  50% { transform: translate(-2%, 1%); }
  100% { transform: translate(1%, -2%); }
}

.cv-mono { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; }
.cv-dim { color: var(--dim); }
.cv-accent { color: var(--azure-hi); }

.cv-eyebrow {
  font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
  text-transform: uppercase; color: var(--azure);
  display: flex; align-items: center; gap: 12px; margin-bottom: 22px;
}
.cv-eyebrow::before {
  content: ""; width: 28px; height: 1px; background: var(--azure); opacity: .7; flex: none;
}

/* ---- buttons ---- */
.cv-root .cv-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 42px; padding: 0 20px; border-radius: 2px;
  font-family: var(--mono); font-size: 11px; letter-spacing: .16em; text-transform: uppercase;
  border: 1px solid transparent; white-space: nowrap;
  transition: background .25s ease, color .25s ease, border-color .25s ease, transform .25s cubic-bezier(.2,.7,.3,1);
}
.cv-root .cv-btn-lg { height: 52px; padding: 0 30px; font-size: 12px; }
.cv-root .cv-btn-solid { background: var(--paper); color: #06070B; font-weight: 500; }
.cv-root .cv-btn-solid:hover { background: #FFFFFF; transform: translateY(-2px); }
.cv-root .cv-btn-line { border-color: var(--line-2); color: var(--paper); }
.cv-root .cv-btn-line:hover { border-color: var(--azure); color: var(--azure-hi); transform: translateY(-2px); }
.cv-root .cv-btn-ghost { color: var(--dim); }
.cv-root .cv-btn-ghost:hover { color: var(--paper); }

/* ---- nav ---- */
.cv-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 50;
  transition: background .4s ease, border-color .4s ease, backdrop-filter .4s ease;
  border-bottom: 1px solid transparent;
}
.cv-nav-solid {
  background: rgba(7,7,10,.78); backdrop-filter: blur(14px); border-bottom-color: var(--line);
}
.cv-nav-inner {
  max-width: 1200px; margin: 0 auto; padding: 16px 24px;
  display: flex; align-items: center; gap: 24px;
}
.cv-brand {
  display: flex; align-items: center; margin-right: auto;
  color: var(--paper); transition: color .25s ease;
}
.cv-brand:hover { color: #FFFFFF; }
.cv-logo { display: block; height: 26px; width: auto; }
.cv-nav-links { display: flex; gap: 28px; }
.cv-nav-links a {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--dim); transition: color .25s ease; position: relative; padding: 4px 0;
}
.cv-nav-links a::after {
  content: ""; position: absolute; left: 0; bottom: 0; height: 1px; width: 0;
  background: var(--azure); transition: width .3s ease;
}
.cv-nav-links a:hover { color: var(--paper); }
.cv-nav-links a:hover::after { width: 100%; }
.cv-nav-actions { display: flex; align-items: center; gap: 10px; }
.cv-burger { display: none; flex-direction: column; gap: 5px; padding: 8px 4px; }
.cv-burger span { display: block; width: 20px; height: 1.5px; background: var(--paper); }
.cv-mobile-menu {
  display: flex; flex-direction: column; gap: 2px; padding: 8px 24px 20px;
  background: rgba(7,7,10,.96); border-bottom: 1px solid var(--line); backdrop-filter: blur(14px);
}
.cv-mobile-menu a, .cv-mobile-signout {
  font-family: var(--mono); font-size: 12px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--dim); padding: 12px 0; border-bottom: 1px solid var(--line);
  text-align: left; width: 100%;
}
.cv-mobile-signout { color: #ff6b6b; }

/* ---- user chip ---- */
.cv-user { position: relative; }
.cv-user-trigger {
  display: flex; align-items: center; gap: 10px;
  height: 42px; padding: 0 10px 0 6px; border-radius: 999px;
  border: 1px solid var(--line-2); color: var(--paper);
  transition: border-color .25s ease, background .25s ease;
}
.cv-user-trigger:hover { border-color: var(--azure); background: rgba(77,124,254,.06); }
.cv-user-avatar {
  display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
  width: 30px; height: 30px; border-radius: 999px; background: var(--azure); color: #06070B;
  font-family: var(--mono); font-size: 12px; font-weight: 600;
}
.cv-user-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cv-user-name {
  font-family: var(--mono); font-size: 12px; letter-spacing: .1em; text-transform: uppercase;
  max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cv-user-chev { width: 12px; height: 12px; color: var(--dim); transition: transform .2s ease; }
.cv-user-chev-open { transform: rotate(180deg); color: var(--paper); }

.cv-user-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
  min-width: 240px; padding: 6px;
  background: #0A0B10; border: 1px solid var(--line-2); border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0,0,0,.4);
  animation: cv-user-menu-in .18s cubic-bezier(.2,.7,.3,1);
}
@keyframes cv-user-menu-in {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: none; }
}
.cv-user-meta {
  padding: 10px 12px 12px; border-bottom: 1px solid var(--line); margin-bottom: 4px;
}
.cv-user-meta-name {
  font-size: 14px; font-weight: 600; color: var(--paper);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cv-user-meta-email {
  margin-top: 2px; font-size: 12px; color: var(--dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cv-user-item {
  display: block; width: 100%; text-align: left;
  padding: 9px 12px; border-radius: 4px;
  font-family: var(--mono); font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  color: var(--paper); transition: background .15s ease, color .15s ease;
}
.cv-user-item:hover { background: rgba(255,255,255,.05); color: var(--azure-hi); }
.cv-user-item-danger { color: #ff6b6b; }
.cv-user-item-danger:hover { background: rgba(255,107,107,.08); color: #ff6b6b; }
.cv-user-form { margin: 0; }

/* ---- hero ---- */
.cv-hero {
  position: relative; min-height: 100vh; min-height: 100svh;
  display: flex; align-items: center; padding: 140px 24px 90px; overflow: hidden;
}
.cv-hero-inner { position: relative; max-width: 1200px; margin: 0 auto; width: 100%; }
.cv-hero-title {
  font-family: var(--display); text-transform: uppercase;
  font-size: clamp(44px, 8.4vw, 108px); line-height: 1; letter-spacing: .004em;
  margin-bottom: 30px;
}
.cv-line { display: block; overflow: hidden; padding-bottom: .06em; }
.cv-word { display: block; animation: cv-rise 1.05s cubic-bezier(.2,.75,.25,1) both; }
.cv-w1 { animation-delay: .08s; }
.cv-w2 { animation-delay: .20s; }
.cv-w3 { animation-delay: .32s; }
.cv-w4 { animation: cv-rise .9s .52s cubic-bezier(.2,.7,.3,1) both; }
.cv-w5 { animation: cv-rise .9s .64s cubic-bezier(.2,.7,.3,1) both; }
.cv-w6 { animation: cv-rise .9s .78s cubic-bezier(.2,.7,.3,1) both; }
@keyframes cv-rise {
  from { transform: translateY(105%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.cv-hero-sub {
  max-width: 46ch; font-size: clamp(16px, 1.5vw, 19px); color: rgba(236,240,248,.72);
  margin-bottom: 30px;
}
.cv-hero-cta { display: flex; flex-wrap: wrap; gap: 12px; }
.cv-hero-foot { margin-top: 30px; letter-spacing: .18em; }


/* ---- sections ---- */
.cv-section { padding: 78px 24px; position: relative; }
.cv-wrap { max-width: 1200px; margin: 0 auto; }
.cv-wrap-narrow { max-width: 820px; }
.cv-head { margin-bottom: 46px; max-width: 720px; }
.cv-h2 {
  font-family: var(--display); text-transform: uppercase;
  font-size: clamp(34px, 5.2vw, 68px); line-height: .94; letter-spacing: .002em;
}
.cv-lede { margin-top: 20px; color: rgba(236,240,248,.66); font-size: 17px; max-width: 56ch; }

.cv-reveal {
  opacity: 0; transform: translateY(26px);
  transition: opacity .85s cubic-bezier(.2,.7,.3,1), transform .85s cubic-bezier(.2,.7,.3,1);
}
.cv-reveal.cv-in { opacity: 1; transform: none; }

/* ---- thesis + stats ---- */
.cv-thesis { margin-bottom: 64px; }
.cv-thesis-text {
  font-family: var(--body); font-weight: 500;
  font-size: clamp(22px, 3.1vw, 40px); line-height: 1.28; letter-spacing: -.01em;
  max-width: 30ch;
}
.cv-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px;
  background: var(--line); border: 1px solid var(--line);
}
.cv-stat { background: var(--ink); padding: 34px 26px; }
.cv-stat-value {
  display: block; font-family: var(--display); font-size: clamp(38px, 5vw, 64px);
  line-height: 1; color: var(--paper);
}
.cv-stat-suffix { color: var(--azure); }
.cv-stat-label {
  font-family: var(--mono); font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
  margin-top: 14px; color: var(--azure);
}
.cv-stat .cv-mono { margin-top: 6px; letter-spacing: .06em; text-transform: none; font-size: 12px; }

/* ---- ledger ---- */
.cv-ledger { display: flex; flex-direction: column; }
.cv-ledger-row {
  display: grid; grid-template-columns: minmax(200px, 1fr) 2fr auto;
  gap: 24px; align-items: center; padding: 15px 0; border-top: 1px solid var(--line);
}
.cv-ledger-name { font-size: 15px; color: rgba(236,240,248,.55); }
.cv-ledger-track { height: 7px; background: rgba(255,255,255,.04); border-radius: 1px; overflow: hidden; }
.cv-ledger-fill {
  display: block; height: 100%; width: 0; background: rgba(236,240,248,.22);
  transition: width 1.2s cubic-bezier(.2,.8,.25,1) .1s;
}
.cv-in .cv-ledger-fill { width: var(--w); }
.cv-ledger-price { color: var(--dim); font-size: 13px; letter-spacing: .04em; }

.cv-ledger-total { border-top-color: var(--line-2); margin-top: 10px; padding-top: 22px; }
.cv-ledger-total .cv-ledger-name { color: var(--paper); font-weight: 600; }
.cv-ledger-total .cv-ledger-fill { background: rgba(236,240,248,.42); }
.cv-ledger-total .cv-ledger-price { color: var(--paper); font-size: 17px; }

.cv-ledger-mine { border-top-color: var(--line-2); border-bottom: 1px solid var(--line); }
.cv-ledger-mine .cv-ledger-name { color: var(--azure-hi); font-weight: 600; }
.cv-ledger-mine .cv-ledger-fill {
  background: var(--azure);
}
.cv-ledger-mine .cv-ledger-price { color: var(--azure-hi); font-size: 17px; }

.cv-savings { margin-top: 52px; max-width: 640px; }
.cv-savings-figure {
  font-family: var(--display); font-size: clamp(56px, 10vw, 128px); line-height: .92;
  display: flex; align-items: flex-start; gap: 2px; margin-top: 10px;
  color: var(--paper);
}
.cv-savings-figure .cv-currency { font-size: .42em; padding-top: .18em; color: var(--azure); }
.cv-savings-figure .cv-stat-value { font-family: var(--display); font-size: inherit; }
.cv-savings-note { margin-top: 18px; color: rgba(236,240,248,.6); font-size: 17px; }

/* ---- cards ---- */
.cv-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.cv-card {
  position: relative; padding: 30px 28px 34px; border: 1px solid var(--line);
  background: var(--surface); border-radius: 3px;
  transition: opacity .85s cubic-bezier(.2,.7,.3,1), transform .45s cubic-bezier(.2,.7,.3,1),
              border-color .35s ease, background .35s ease;
}
.cv-card:hover { transform: translateY(-4px); border-color: var(--azure); background: #12151D; }
.cv-card-tag { color: var(--azure); margin-bottom: 20px; }
.cv-card-title { font-size: 21px; font-weight: 600; letter-spacing: -.01em; margin-bottom: 10px; }
.cv-card-body { color: rgba(236,240,248,.62); font-size: 15px; }

/* ---- steps ---- */
.cv-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; }
.cv-step { display: flex; gap: 18px; align-items: flex-start; }
.cv-step-num { color: var(--azure); font-size: 12px; padding-top: 6px; }
.cv-step-title { font-family: var(--display); text-transform: uppercase; font-size: 26px; letter-spacing: .02em; margin-bottom: 10px; }
.cv-step-body { color: rgba(236,240,248,.62); font-size: 15px; }

/* ---- tiers ---- */
.cv-tiers { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: stretch; }
.cv-tier {
  position: relative; display: flex; flex-direction: column;
  padding: 30px 26px 28px; border: 1px solid var(--line); border-radius: 3px;
  background: var(--surface);
  transition: opacity .85s cubic-bezier(.2,.7,.3,1), transform .45s cubic-bezier(.2,.7,.3,1), border-color .4s ease, background .4s ease;
}
.cv-tier.cv-in.cv-tier-active { transform: translateY(-8px); border-color: var(--azure); background: #15151C; }
.cv-tier-pop { border-color: rgba(77,124,254,.42); }
.cv-pop-flag {
  position: absolute; top: -1px; right: -1px; background: var(--azure); color: #0A0A0C;
  padding: 5px 10px; font-weight: 500;
}
.cv-tier-name {
  display: flex; align-items: baseline; gap: 10px;
  padding-bottom: 22px; margin-bottom: 24px; border-bottom: 1px solid var(--line);
}
.cv-tier-count {
  font-family: var(--display); font-size: 40px; line-height: .9; color: var(--azure);
}
.cv-tier-count-label {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--dim); font-weight: 400;
}
.cv-tier-price { font-family: var(--display); font-size: 54px; line-height: 1; display: flex; align-items: flex-start; gap: 2px; }
.cv-currency { font-size: 26px; padding-top: 6px; color: var(--dim); }
.cv-per { font-family: var(--mono); font-size: 11px; letter-spacing: .1em; color: var(--dim); align-self: flex-end; padding-bottom: 8px; margin-left: 6px; }
.cv-tier-blurb { color: rgba(236,240,248,.6); font-size: 14px; margin-top: 14px; }
.cv-tier-list { margin: 24px 0 28px; display: flex; flex-direction: column; gap: 10px; }
.cv-tier-list li {
  font-size: 14px; color: rgba(236,240,248,.74); display: flex; gap: 10px; align-items: baseline;
}
.cv-tier-list li::before { content: "—"; color: var(--azure); flex: none; }
.cv-tier-btn { margin-top: auto; width: 100%; }
.cv-note { margin-top: 34px; color: var(--dim); font-size: 14px; }
.cv-note a { color: var(--azure-hi); border-bottom: 1px solid rgba(77,124,254,.4); }

/* ---- faq ---- */
.cv-faq { border-top: 1px solid var(--line); }
.cv-faq-item { border-bottom: 1px solid var(--line); }
.cv-faq-q {
  width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 20px;
  padding: 22px 0; text-align: left; font-size: 18px; font-weight: 500;
  transition: color .3s ease;
}
.cv-faq-q:hover { color: var(--azure-hi); }
.cv-faq-icon { position: relative; width: 12px; height: 12px; flex: none; }
.cv-faq-icon::before, .cv-faq-icon::after {
  content: ""; position: absolute; background: var(--azure); transition: transform .35s cubic-bezier(.2,.7,.3,1);
}
.cv-faq-icon::before { top: 5.5px; left: 0; width: 12px; height: 1px; }
.cv-faq-icon::after { left: 5.5px; top: 0; width: 1px; height: 12px; }
.cv-faq-open .cv-faq-icon::after { transform: rotate(90deg); }
.cv-faq-a {
  display: grid; grid-template-rows: 0fr; transition: grid-template-rows .4s cubic-bezier(.2,.7,.3,1);
}
.cv-faq-open .cv-faq-a { grid-template-rows: 1fr; }
.cv-faq-a > p {
  overflow: hidden; color: rgba(236,240,248,.6); font-size: 16px; max-width: 62ch;
  opacity: 0; transition: opacity .35s ease;
}
.cv-faq-open .cv-faq-a > p { opacity: 1; padding-bottom: 24px; }

/* ---- cta ---- */
.cv-cta { position: relative; padding: 104px 24px 118px; text-align: center; overflow: hidden; }
.cv-cta-inner { position: relative; max-width: 760px; margin: 0 auto; }
.cv-cta-title {
  font-family: var(--display); text-transform: uppercase;
  font-size: clamp(40px, 7vw, 92px); line-height: .92; margin-bottom: 18px;
}
.cv-cta-sub { letter-spacing: .18em; margin-bottom: 34px; }
.cv-cta .cv-hero-cta { justify-content: center; }

/* ---- footer ---- */
.cv-footer { padding: 40px 24px 46px; }
.cv-footer-inner { display: flex; justify-content: space-between; align-items: center; gap: 20px; flex-wrap: wrap; }
.cv-footer-links { display: flex; gap: 24px; }
.cv-footer-links a {
  font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--dim); transition: color .25s ease;
}
.cv-footer-links a:hover { color: var(--azure-hi); }

/* ---- responsive ---- */
@media (max-width: 1000px) {
  .cv-cards, .cv-steps { grid-template-columns: repeat(2, 1fr); }
  .cv-tiers { grid-template-columns: repeat(2, 1fr); }
  .cv-stats { grid-template-columns: repeat(2, 1fr); }
  .cv-nav-links { display: none; }
  .cv-burger { display: flex; }
}
@media (max-width: 700px) {
  .cv-section { padding: 58px 20px; }
  .cv-hero { padding: 120px 20px 80px; }
  .cv-cards, .cv-steps, .cv-tiers { grid-template-columns: 1fr; }
  .cv-head { margin-bottom: 34px; }
  .cv-ledger-row { grid-template-columns: 1fr auto; gap: 8px 16px; }
  .cv-ledger-track { grid-column: 1 / -1; }
  .cv-btn-ghost, .cv-nav-signin { display: none; }
  /* Trim the chip on mobile — the burger drawer carries the name/email/actions, so the
     chip is only for "yes, still signed in" recognition. */
  .cv-user-name { display: none; }
  .cv-user-trigger { padding: 0 6px; }
  .cv-logo { height: 21px; }
  .cv-thesis { margin-bottom: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .cv-root *, .cv-root *::before, .cv-root *::after {
    animation-duration: .001ms !important; animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
  .cv-reveal { opacity: 1; transform: none; }
  .cv-ledger-fill { width: var(--w); }
  .cv-grain { display: none; }
}
`;
