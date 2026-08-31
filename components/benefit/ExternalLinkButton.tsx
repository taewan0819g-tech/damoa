import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExternalLinkButtonProps {
  href?: string;
  label: string;
  variant?: "primary" | "outline";
}

export function ExternalLinkButton({ href, label, variant = "outline" }: ExternalLinkButtonProps) {
  if (!href) return null;

  return (
    <Button asChild variant={variant} className="w-full justify-center">
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} (새 탭에서 열림)`}>
        {label}
        <ExternalLink className="size-4" aria-hidden="true" />
      </a>
    </Button>
  );
}
