// Placeholder root page.
// TODO(auth package): replace with redirect("/login") once the /login route
// and Supabase session handling exist.
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6">
      <h1 className="text-heading-sm font-medium">
        Smark<span className="text-smark-orange">Stock</span>
      </h1>
      <p className="text-body-sm text-silver-mist">
        Scaffold up. App routes land here next.
      </p>
    </main>
  );
}
