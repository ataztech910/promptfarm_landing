import { Container, SiteFooter } from "@/components/SiteShell";

const sections = [
  {
    title: "What we collect",
    body: "If you join the waitlist, we collect the name and email address you submit through the form.",
  },
  {
    title: "How we use it",
    body: "We use waitlist data to contact you about PromptFarm access, product updates, and launch-related communication.",
  },
  {
    title: "Third-party processing",
    body: "The waitlist form is processed by Formspark. Your submission may also be processed by our hosting and infrastructure providers as part of normal website delivery.",
  },
  {
    title: "Retention",
    body: "We keep waitlist submissions for as long as they are relevant to pre-release access, onboarding, and product communication.",
  },
  {
    title: "Your choices",
    body: "You can request that we update or delete your waitlist information. Contact us through our support channels.",
  },
];

const Privacy = () => (
  <div className="min-h-screen">
    <main className="pt-24">
      <section className="border-b border-border py-20">
        <Container className="max-w-4xl">
          <p className="mb-4 text-xs font-mono-app uppercase tracking-[0.24em] text-primary">Privacy</p>
          <h1 className="mb-6 text-4xl font-bold tracking-display md:text-6xl">
            Privacy policy for the PromptFarm waitlist.
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Last updated on March 16, 2026. This page describes how PromptFarm handles information submitted through the current landing page.
          </p>
        </Container>
      </section>

      <section className="py-16">
        <Container className="max-w-4xl">
          <div className="grid gap-4">
            {sections.map((section) => (
              <div key={section.title} className="rounded-2xl border border-border bg-card p-6">
                <h2 className="mb-3 text-xl font-semibold tracking-display">{section.title}</h2>
                <p className="text-sm leading-7 text-text-secondary">{section.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-border bg-card py-16">
        <Container className="max-w-4xl">
          <h2 className="mb-4 text-2xl font-semibold tracking-display">Contact</h2>
          <p className="max-w-2xl text-sm leading-7 text-text-secondary">
            For privacy-related requests, contact PromptFarm through our support channels.
          </p>
        </Container>
      </section>
    </main>
    <SiteFooter />
  </div>
);

export default Privacy;
