"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/primitives";
import { getProtectedSiteUrl } from "@/lib/urls";

export function HeroDemoButton({ initialUrl }: { initialUrl?: string | null }) {
  const [url, setUrl] = useState(() => getProtectedSiteUrl(initialUrl));

  useEffect(() => {
    setUrl(getProtectedSiteUrl(initialUrl));
  }, [initialUrl]);

  return (
    <ButtonLink href={url} external variant="secondary" size="lg">
      <span>View Live Demo</span>
      <ArrowRight className="size-4" aria-hidden />
    </ButtonLink>
  );
}
