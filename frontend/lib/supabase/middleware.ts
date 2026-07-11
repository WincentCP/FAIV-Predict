import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/predict",
  "/calendar",
  "/history",
  "/insights",
  "/niches",
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const isDashboardRoute = PROTECTED_PREFIXES.some((p) =>
    request.nextUrl.pathname.startsWith(p)
  );
  const isApiRoute = request.nextUrl.pathname.startsWith("/api");

  // Without Supabase configuration no session can exist: treat every request
  // as unauthenticated instead of throwing a 500 on every route.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[Middleware] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set; authentication is unavailable."
    );
    if (isApiRoute) {
      return NextResponse.json(
        { status: "error", message: "Authentication is not configured." },
        { status: 401 }
      );
    }
    if (isDashboardRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // This updates the session and cookie. Do not remove.
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data?.user || null;
  } catch (err) {
    console.warn("Middleware failed to retrieve user session:", err);
  }

  // API routes answer with 401 JSON, never a redirect — the BFF must not be
  // callable without a login session.
  if (isApiRoute && !user) {
    return NextResponse.json(
      { status: "error", message: "Sign in to use this API." },
      { status: 401 }
    );
  }

  if (isDashboardRoute && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (request.nextUrl.pathname === "/" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
