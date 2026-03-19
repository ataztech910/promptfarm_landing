"use client";

import { useEffect, useState, lazy, Suspense } from "react";

const Editor = lazy(() => import("@/screens/Editor"));

export default function Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}
