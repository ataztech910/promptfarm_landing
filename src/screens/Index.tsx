import { useState } from "react";
import { motion } from "framer-motion";
import { Box, Share2, ShieldCheck, Database } from "lucide-react";
import { Container, SiteFooter } from "@/components/SiteShell";

const ease = [0.16, 1, 0.3, 1] as const;

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-primary mb-6 font-mono-app">
    {children}
  </span>
);


const EmailCapture = ({ buttonText = "Join Early Access" }: { buttonText?: string }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submittedName, setSubmittedName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const formActionUrl = process.env.NEXT_PUBLIC_FORMSPARK_ACTION_URL;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || isSubmitting || honeypot) return;

    if (!formActionUrl) {
      setError("Form is not configured yet.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(formActionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          source: "promptfarm-landing",
          _honeypot: honeypot,
        }),
      });

      if (!response.ok) {
        throw new Error("Submission failed");
      }

      setSubmittedName(name);
      setSubmitted(true);
      setName("");
      setEmail("");
    } catch {
      setError("Couldn't send the form. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-success/25 bg-success/10 p-5 text-left shadow-[0_0_0_1px_rgba(142,244,106,0.06)]">
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-success/30 bg-success/15 text-success">
            ✓
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">You are on the list.</p>
            <p className="text-xs text-text-secondary font-mono-app">We saved your contact details successfully.</p>
          </div>
        </div>
        <p className="text-sm text-text-secondary">
          Thanks for joining, <span className="text-foreground">{submittedName}</span>. We&apos;ll reach out when the next PromptFarm access wave opens.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="relative flex w-full max-w-xl flex-col gap-3 mx-auto">
      <div className="grid w-full gap-3 sm:grid-cols-[1.05fr_1.25fr_auto]">
        <input
          type="text"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          required
          className="h-12 w-full rounded-lg bg-card border border-border px-4 text-sm text-foreground transition-all placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          required
          className="h-12 w-full rounded-lg bg-card border border-border px-4 text-sm text-foreground transition-all placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono-app"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="h-12 w-full rounded-lg bg-primary px-8 text-sm font-semibold whitespace-nowrap text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
        >
          {isSubmitting ? "Sending..." : buttonText}
        </button>
      </div>
      <input
        type="text"
        name="_honeypot"
        tabIndex={-1}
        autoComplete="off"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        className="absolute -left-[9999px] opacity-0 pointer-events-none"
        aria-hidden="true"
      />
      {error ? <p className="w-full text-left text-xs text-error font-mono-app sm:absolute sm:translate-y-16">{error}</p> : null}
    </form>
  );
};

const Hero = () => (
  <section className="relative pt-32 pb-20 overflow-hidden border-b border-border">
    <div className="absolute inset-0 z-0 grid-bg pointer-events-none" />
    <Container className="relative z-10 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease }}
      >
        <Badge>Early Access Phase 1</Badge>
        <h1 className="text-5xl md:text-7xl font-bold tracking-display mb-8 text-balance leading-[1.1]">
          Prompts are the new{" "}
          <span className="text-primary">source code.</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 text-pretty">
          PromptFarm is a developer tool for designing structured and composable prompts with typed inputs, and visual prompt graphs.
        </p>
        <EmailCapture />
        <p className="mt-4 text-xs text-text-tertiary font-mono-app">
          Be the first to try PromptFarm. No marketing fluff.
        </p>
      </motion.div>

      {/* Abstract workflow visual */}
      <div className="mt-20 relative h-48 md:h-72 border border-border rounded-2xl bg-card overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center gap-4 md:gap-8 px-4 opacity-50">
          <div className="w-28 md:w-32 h-14 md:h-16 border border-primary/30 rounded bg-primary/5 flex items-center justify-center font-mono-app text-[10px] text-primary shrink-0">
            INPUT_NODE
          </div>
          <div className="hidden md:block h-px bg-primary/30 flex-grow max-w-[80px]" />
          <div className="w-32 md:w-40 h-20 md:h-24 border border-border rounded bg-muted/20 flex items-center justify-center font-mono-app text-[10px] text-muted-foreground shrink-0">
            PROMPT_ENGINE_V2
          </div>
          <div className="hidden md:block h-px bg-border flex-grow max-w-[80px]" />
          <div className="w-28 md:w-32 h-14 md:h-16 border border-success/30 rounded bg-success/5 flex items-center justify-center font-mono-app text-[10px] text-success shrink-0">
            OUTPUT_ARTIFACT
          </div>
        </div>
      </div>
    </Container>
  </section>
);

const ProblemSection = () => {
  const problems = [
    "Prompts live inside messy chat histories",
    "No version control for prompt iterations",
    "Complex logic becomes unreadable strings",
    "Teams cannot collaborate on prompt logic",
    "Workflows break without validation",
  ];

  return (
    <section className="py-24 border-b border-border">
      <Container>
        <div className="grid md:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl font-semibold tracking-display mb-6">
              Prompt engineering is still chaos.
            </h2>
            <p className="text-muted-foreground mb-8">
              Most teams treat prompts as disposable text. As your AI features grow, this "string-based" development becomes your biggest technical debt.
            </p>
            <ul className="space-y-4">
              {problems.map((p, i) => (
                <li key={i} className="flex items-center gap-3 text-sm font-mono-app text-text-secondary">
                  <span className="text-error/60">✕</span> {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-card border border-border p-6 rounded-xl font-mono-app text-xs text-primary/80 overflow-x-auto">
            <div className="mb-4 text-text-tertiary">{"// The current mess"}</div>
            <div className="space-y-1 whitespace-pre">
              <p>{"const prompt = `You are a helpful assistant. \\n` +"}</p>
              <p className="pl-4">{"`Use the following context: ${context} \\n` +"}</p>
              <p className="pl-4">{"`But if the user says ${userInput}...`;"}</p>
              <p className="mt-4 text-error/60">{"// Hard to test. Hard to scale. Hard to maintain."}</p>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
};

const SolutionSection = () => {
  const features = [
    { title: "Structured Components", icon: <Box size={20} />, desc: "Define prompts as reusable, typed components." },
    { title: "Visual Graphs", icon: <Share2 size={20} />, desc: "Map complex multi-step LLM chains visually." },
    { title: "Validation Layer", icon: <ShieldCheck size={20} />, desc: "Unit test your prompts before they hit production." },
    { title: "Prompt Artifacts", icon: <Database size={20} />, desc: "Versioned deployments for every prompt change." },
  ];

  return (
    <section className="py-24">
      <Container>
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-display mb-4 text-balance">
            Treat prompts like real software.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-pretty">
            PromptFarm provides the infrastructure to manage the entire lifecycle of your AI logic.
          </p>
        </div>
        <div className="grid md:grid-cols-4 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className="p-6 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors group"
            >
              <div className="text-primary mb-4 group-hover:scale-110 transition-transform">{f.icon}</div>
              <h3 className="font-medium mb-2">{f.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
};

const VisualConcept = () => {
  const steps = ["User Input", "Context Builder", "Example Injection", "Prompt Execution", "Output Artifact"];

  return (
    <section className="py-24 border-y border-border bg-card">
      <Container>
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-display mb-4 text-balance">
            Design AI workflows visually.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-pretty">
            Connect nodes to form robust AI pipelines. Each node represents a discrete, testable step in your logic.
          </p>
        </div>
        <div className="flex flex-col items-center gap-4 max-w-xs mx-auto">
          {steps.map((step, i) => (
            <div key={step}>
              <div className="w-full p-4 border border-border bg-secondary rounded-lg text-center font-mono-app text-sm">
                {step}
              </div>
              {i < steps.length - 1 && <div className="h-8 w-px bg-primary/30 mx-auto" />}
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
};

const WhoSection = () => {
  const audiences = ["AI engineers", "LLM product teams", "Developers building AI tools", "Prompt engineers"];

  return (
    <section className="py-24 border-b border-border">
      <Container className="text-center">
        <h2 className="text-3xl font-semibold tracking-display mb-10">Who it's for.</h2>
        <div className="flex flex-wrap justify-center gap-4">
          {audiences.map((a) => (
            <span key={a} className="px-5 py-2.5 rounded-full border border-border bg-card text-sm font-mono-app text-muted-foreground">
              {a}
            </span>
          ))}
        </div>
      </Container>
    </section>
  );
};

const VisionSection = () => (
  <section className="py-24 border-b border-border">
    <Container className="text-center max-w-3xl">
      <Badge>The Vision</Badge>
      <h2 className="text-3xl font-semibold tracking-display mb-6">
        The infrastructure layer for AI development.
      </h2>
      <p className="text-lg text-muted-foreground leading-relaxed">
        As we move from simple API calls to complex autonomous agents, the prompt becomes the most critical piece of infrastructure. PromptFarm is building the toolchain for this evolution—from versioning to observability.
      </p>
    </Container>
  </section>
);

const FooterCTA = () => (
  <section className="py-32">
    <Container className="text-center">
      <h2 className="text-4xl font-bold tracking-display mb-6">
        Build the next generation of AI systems.
      </h2>
      <p className="text-muted-foreground mb-10 max-w-xl mx-auto">
        Join the waitlist to get early access to the PromptFarm beta and infrastructure tools.
      </p>
      <EmailCapture buttonText="Join Waitlist" />
      <p className="mt-6 text-xs text-text-tertiary font-mono-app">
        No spam. Just product updates and early access.
      </p>
    </Container>
  </section>
);

const LandingPage = () => (
  <div className="min-h-screen">
    <main>
      <Hero />
      <ProblemSection />
      <SolutionSection />
      <VisualConcept />
      <WhoSection />
      <VisionSection />
      <FooterCTA />
    </main>
    <SiteFooter />
  </div>
);

export default LandingPage;
