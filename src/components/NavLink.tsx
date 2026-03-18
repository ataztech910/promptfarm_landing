"use client";

import { forwardRef } from "react";
import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface NavLinkCompatProps
  extends Omit<React.ComponentPropsWithoutRef<"a">, "href" | "className"> {
  to: LinkProps["href"];
  className?: string;
  activeClassName?: string;
  pendingClassName?: string;
}

const NavLink = forwardRef<HTMLAnchorElement, NavLinkCompatProps>(
  ({ className, activeClassName, pendingClassName: _pendingClassName, to, ...props }, ref) => {
    const pathname = usePathname();
    const hrefValue = typeof to === "string" ? to : to.pathname;
    const isActive = typeof hrefValue === "string" ? pathname === hrefValue : false;

    return (
      <Link
        ref={ref}
        href={to}
        className={cn(className, isActive && activeClassName)}
        {...props}
      />
    );
  },
);

NavLink.displayName = "NavLink";

export { NavLink };
