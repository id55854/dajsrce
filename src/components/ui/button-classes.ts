import clsx from "clsx";

// Deliberately NOT a "use client" module: server components need to call
// buttonClasses() to style a plain <Link>/<a>, and an export from a client
// module can only be rendered, never invoked, from the server.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white shadow-raised hover:bg-brand-strong",
  secondary:
    "border border-border-subtle bg-surface-raised text-ink hover:bg-surface-sunken",
  ghost: "text-ink-secondary hover:bg-surface-sunken hover:text-ink",
  danger: "bg-danger text-white shadow-raised hover:brightness-110",
  success: "bg-success text-white shadow-raised hover:brightness-110",
};

// `md` is 44px tall — the minimum comfortable touch target. Reserve `sm` for
// dense, secondary controls that sit inside an already-generous hit area.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-10 gap-1.5 px-4 text-sm",
  md: "h-11 gap-2 px-5 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
};

/**
 * The single source of truth for how an interactive control looks. Exported
 * separately from <Button> so `<Link>` and `<a>` can wear the same clothes
 * without this having to become a polymorphic component.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return clsx(
    "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
    "transition-[background-color,border-color,color,box-shadow,transform,filter]",
    "duration-150 ease-out",
    // Feedback lands on press, not on release.
    "motion-safe:active:scale-[0.97]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className
  );
}
