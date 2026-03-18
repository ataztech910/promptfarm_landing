import { Container, SiteFooter, SiteHeader, CHANGELOG_URL, REPO_URL } from "@/components/SiteShell";

const changelogLinks = [
  {
    title: "GitHub Repository",
    href: REPO_URL,
    description: "The public source of truth for PromptFarm while the product is still in early access.",
  },
  {
    title: "Commit History",
    href: CHANGELOG_URL,
    description: "Track the latest public code changes directly in the repository timeline.",
  },
];

const Changelog = () => (
  <div className="min-h-screen">
    <SiteHeader />
    <main className="pt-24">
      <section className="border-b border-border py-20">
        <Container className="max-w-4xl">
          <p className="mb-4 text-xs font-mono-app uppercase tracking-[0.24em] text-primary">Changelog</p>
          <h1 className="mb-6 text-4xl font-bold tracking-display md:text-6xl">
            Public product updates, without the fluff.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            PromptFarm is still early. Until a full release-notes system ships, the public changelog lives in GitHub.
          </p>
        </Container>
      </section>

      <section className="py-16">
        <Container className="grid gap-6 md:grid-cols-2">
          {changelogLinks.map((item) => (
            <a
              key={item.title}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <p className="mb-3 text-xs font-mono-app uppercase tracking-[0.22em] text-primary">External</p>
              <h2 className="mb-3 text-2xl font-semibold tracking-display">{item.title}</h2>
              <p className="text-sm leading-7 text-text-secondary">{item.description}</p>
            </a>
          ))}
        </Container>
      </section>

      <section className="border-y border-border bg-card py-16">
        <Container className="max-w-4xl">
          <h2 className="mb-6 text-2xl font-semibold tracking-display">What to expect here</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-background/70 p-5">
              <p className="mb-2 text-sm font-medium text-foreground">Product milestones</p>
              <p className="text-sm text-text-secondary">Major releases, waitlist openings, and roadmap-level changes.</p>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-5">
              <p className="mb-2 text-sm font-medium text-foreground">Infra changes</p>
              <p className="text-sm text-text-secondary">Changes to the landing page, signup flow, and early access infrastructure.</p>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-5">
              <p className="mb-2 text-sm font-medium text-foreground">Clear sources</p>
              <p className="text-sm text-text-secondary">When updates are public, GitHub remains the canonical source.</p>
            </div>
          </div>
        </Container>
      </section>
    </main>
    <SiteFooter />
  </div>
);

export default Changelog;
