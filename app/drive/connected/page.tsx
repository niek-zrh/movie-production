import Link from "next/link";

/** Landing page for Drive OAuth errors (success redirects into the app). */
export default async function DriveConnectedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reason?: string }>;
}) {
  const { status, reason } = await searchParams;
  const failed = status === "error";
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="font-display text-xl font-semibold">
          {failed ? "Drive connection didn't complete" : "Drive connected"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {failed
            ? `Google returned: ${reason ?? "unknown error"}. Go back to the app and try connecting again.`
            : "You can close this tab and return to the app."}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-4">
          Back to Kinolab
        </Link>
      </div>
    </main>
  );
}
