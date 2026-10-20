import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie presence check; pages still validate the session against the database.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("ct_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/settings/:path*", "/compose/:path*", "/calendar/:path*", "/library/:path*", "/channels/:path*", "/inbox/:path*", "/automations/:path*", "/analytics/:path*"] };
