import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full text-xs font-medium px-2.5 py-1", {
  variants: {
    variant: {
      default: "bg-surface-muted text-foreground-muted",
      accent: "bg-accent-soft text-accent",
      outline: "border border-border text-foreground-muted",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
