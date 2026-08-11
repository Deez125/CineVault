import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The setup screen borrows the auth layout on purpose — it is the moment BETWEEN having an
 * account and being able to use the app, and it should feel like part of the same guided
 * flow that just brought them here. Nothing to click on but the form.
 */
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <Link href="/" className="mb-8 flex items-center gap-2.5">
        <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" priority />
        <span className="text-lg font-semibold tracking-tight">CineVault</span>
      </Link>

      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
