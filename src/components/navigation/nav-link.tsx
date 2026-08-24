"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The only client component required for navigation: it reads the current
 * pathname so callers can style the active destination. Active state is
 * exposed through `data-active`, letting each surface (sidebar, workspace
 * tabs) own its own styling with `data-[active=true]:` variants.
 */
export function NavLink({
  href,
  exact = false,
  children,
  ...props
}: React.ComponentProps<typeof Link> & {
  href: string;
  /** Match the href exactly instead of also matching nested routes. */
  exact?: boolean;
}) {
  const pathname = usePathname();
  const isActive = exact
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      data-active={isActive}
      aria-current={isActive ? "page" : undefined}
      {...props}
    >
      {children}
    </Link>
  );
}
